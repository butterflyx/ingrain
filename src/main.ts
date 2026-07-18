import {
  App,
  ButtonComponent,
  Component,
  ItemView,
  MarkdownRenderer,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  WorkspaceLeaf,
} from "obsidian";
import {
  Card,
  CardState,
  ClozeScope,
  DEFAULT_SETTINGS,
  FlowcardsSettings,
  PersistedData,
  Rating,
  StateMap,
} from "./types";
import { parseNote } from "./parser";
import {
  reconcileNote,
  renameNotePath,
  sweepOrphans,
  dueCards,
} from "./reconcile";
import {
  ReviewSessionState,
  canRate,
  canReveal,
  currentCard,
  isComplete,
  rate,
  reveal,
  sessionProgress,
  startSession,
} from "./review";
import { coordinateSiblingDue } from "./scheduler";
import { DeckNode, RatingBreakdown, buildDeckTree, filterByDeck } from "./decks";

// This is the ONLY file that touches the Obsidian API. It stays thin on
// purpose: parse + reconcile + schedule + the review session state machine
// are all pure and tested elsewhere; ReviewModal/DecksView below only wire
// DOM to it.

const VIEW_TYPE_DECKS = "flowcards-decks-view";

export default class FlowcardsPlugin extends Plugin {
  settings: FlowcardsSettings = DEFAULT_SETTINGS;
  states: StateMap = {};
  /** hash -> most-recently-parsed Card content. NOT persisted; rebuilt from
   *  the vault on load/rebuild and kept current by indexFile(). Exists only
   *  so the review Modal can render front/back for due hashes, since
   *  CardState alone has no renderable content. */
  cardCache: Record<string, Card> = {};
  /** Currently-open DecksView instances. Pushed a refresh directly from
   *  every state-changing operation below, since not all of them route
   *  through a workspace leaf-focus change that DecksView could otherwise
   *  react to on its own -- e.g. resetAllProgress() is triggered from the
   *  settings tab, which isn't a workspace leaf at all. */
  private decksViews = new Set<DecksView>();

  registerDecksView(view: DecksView): void {
    this.decksViews.add(view);
  }

  unregisterDecksView(view: DecksView): void {
    this.decksViews.delete(view);
  }

  private notifyDecksChanged(): void {
    for (const view of this.decksViews) view.render();
  }

  async onload() {
    await this.loadPersisted();

    // Keep path metadata fresh on rename. Non-load-bearing: identity is the
    // content hash, so even a missed rename self-heals on the next parse.
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile) {
          this.states = renameNotePath(this.states, oldPath, file.path);
          void this.save();
        }
      }),
    );

    // Re-index a note whenever it changes.
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && file.extension === "md") void this.indexFile(file);
      }),
    );

    // Index a brand-new note as soon as it's created, not just on edit --
    // otherwise cards in it wouldn't show up until the next full rebuild.
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFile && file.extension === "md") void this.indexFile(file);
      }),
    );

    this.addCommand({
      id: "review-due",
      name: "Review due cards",
      callback: () => this.startReview(),
    });

    this.addCommand({
      id: "rebuild-index",
      name: "Rebuild index (sweep orphans)",
      callback: () => this.rebuildIndex(),
    });

    this.addCommand({
      id: "browse-decks",
      name: "Open deck overview",
      callback: () => void this.activateDecksView(),
    });

    this.addSettingTab(new FlowcardsSettingTab(this.app, this));

    this.registerView(VIEW_TYPE_DECKS, (leaf) => new DecksView(leaf, this));
    // Lets a plain Markdown link -- [Decks](obsidian://flowcards-decks) --
    // open the deck overview from any note (e.g. a daily note), since
    // Obsidian wikilinks can only target real vault files, never a
    // plugin view without file backing.
    this.registerObsidianProtocolHandler("flowcards-decks", () => void this.activateDecksView());

    this.addRibbonIcon("graduation-cap", "Open deck overview", () => void this.activateDecksView());

    // Full sweep on load to purge states from deleted notes.
    this.app.workspace.onLayoutReady(() => void this.rebuildIndex());
  }

  /** Opens the deck overview in a normal tab, reusing one if already open. */
  async activateDecksView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_DECKS)[0];
    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_DECKS, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_DECKS);
    void this.save();
  }

  private async indexFile(file: TFile) {
    const md = await this.app.vault.cachedRead(file);
    const cards = parseNote(md, file.path, this.settings);
    const result = reconcileNote(cards, this.states, file.path);
    this.states = result.states;
    for (const c of cards) this.cardCache[c.hash] = c;
    for (const h of result.orphaned) delete this.cardCache[h];
    await this.save();
    this.notifyDecksChanged();
  }

  private async rebuildIndex() {
    const live = new Set<string>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const md = await this.app.vault.cachedRead(file);
      const cards = parseNote(md, file.path, this.settings);
      const result = reconcileNote(cards, this.states, file.path);
      this.states = result.states;
      for (const c of cards) {
        live.add(c.hash);
        this.cardCache[c.hash] = c;
      }
      for (const h of result.orphaned) delete this.cardCache[h];
    }
    const swept = sweepOrphans(this.states, live);
    this.states = swept.states;
    for (const h of swept.purged) delete this.cardCache[h];
    await this.save();
    this.notifyDecksChanged();
  }

  startReview(deckPath?: string, onClose?: () => void) {
    const due = filterByDeck(dueCards(this.states), this.cardCache, deckPath);
    if (!due.length) {
      new Notice(deckPath ? `Flowcards: no cards due in ${deckPath}.` : "Flowcards: no cards due.");
      return;
    }

    const resolved: CardState[] = [];
    const cardsByHash = new Map<string, Card>();
    for (const state of due) {
      const card = this.cardCache[state.hash];
      if (!card) continue; // indexing race: rebuildIndex() runs async, unawaited
      resolved.push(state);
      cardsByHash.set(state.hash, card);
    }

    if (!resolved.length) {
      new Notice("Flowcards: still indexing, try again in a moment.");
      return;
    }

    new ReviewModal(this.app, this, resolved, cardsByHash, onClose).open();
  }

  /** Persist the result of a single review. Write-through (not batched) so
   *  progress survives an app kill mid-session on mobile. If reverseOf
   *  names a sibling that still exists in the store, its due date is
   *  coordinated too (see scheduler.ts coordinateSiblingDue()) so it
   *  won't also show up as due in the same/next session. */
  async recordReview(hash: string, state: CardState, reverseOf?: string): Promise<void> {
    let next: StateMap = { ...this.states, [hash]: state };
    const sibling = reverseOf ? next[reverseOf] : undefined;
    if (sibling) next = { ...next, [reverseOf!]: coordinateSiblingDue(sibling, state) };
    this.states = next;
    await this.save();
    this.notifyDecksChanged();
  }

  private async loadPersisted() {
    const data = (await this.loadData()) as Partial<PersistedData> | null;
    if (data?.schema === 1) {
      this.states = data.states ?? {};
      this.settings = data.settings ?? DEFAULT_SETTINGS;
    }
  }

  private async save() {
    const data: PersistedData = { schema: 1, states: this.states, settings: this.settings };
    await this.saveData(data);
  }

  /** Persist settings-tab edits AND reindex the vault with them, so a
   *  changed calloutType/deckTagRoot/etc. takes effect without a manual
   *  "Rebuild index". Called once when the settings tab is closed (see
   *  FlowcardsSettingTab.hide()), not per keystroke -- rebuildIndex()
   *  reads every markdown file, too expensive to run on every onChange.
   *  rebuildIndex() already calls save() at the end, persisting both
   *  states and settings in one pass. */
  async saveSettings(): Promise<void> {
    await this.rebuildIndex();
  }

  /** Wipes all scheduling history vault-wide. rebuildIndex() then repopulates
   *  a fresh initialState() for every currently-known card via the same
   *  reconcile path as any other reindex, and persists. Gated behind
   *  ConfirmResetModal in the settings tab -- irreversible. */
  async resetAllProgress(): Promise<void> {
    this.states = {};
    await this.rebuildIndex();
  }
}

/**
 * DOM-wiring glue only — every state transition (reveal, rate, progress,
 * completion) is delegated to the pure session state machine in review.ts,
 * which is what vitest actually covers. This class itself can only be
 * verified manually in a live vault (see CLAUDE.md).
 */
class ReviewModal extends Modal {
  private session: ReviewSessionState;
  private readonly cardsByHash: Map<string, Card>;
  private readonly mdComponent = new Component();

  constructor(
    app: App,
    private plugin: FlowcardsPlugin,
    due: CardState[],
    cardsByHash: Map<string, Card>,
    private onCloseCallback?: () => void,
  ) {
    super(app);
    this.session = startSession(due);
    // Snapshot passed in by the caller, not read live from plugin.cardCache,
    // so a modify event on an unrelated note during the session can't change
    // what's displayed mid-review.
    this.cardsByHash = cardsByHash;
  }

  onOpen() {
    this.mdComponent.load();
    this.registerKeymap();
    this.render();
  }

  onClose() {
    this.mdComponent.unload();
    this.contentEl.empty();
    // Fires whether the session was completed or ended early (Esc/close
    // button) -- e.g. lets DecksView refresh its due/total counts.
    this.onCloseCallback?.();
  }

  private registerKeymap() {
    // Desktop-only enhancement layered on top of the buttons below, which
    // remain the primary interaction path (isDesktopOnly: false in the
    // manifest — Obsidian Mobile has no keyboard by default).
    this.scope.register([], " ", (evt) => {
      evt.preventDefault();
      this.handleReveal();
    });
    this.scope.register([], "Enter", () => this.handleReveal());
    this.scope.register([], "1", () => this.handleRate(1));
    this.scope.register([], "2", () => this.handleRate(2));
    this.scope.register([], "3", () => this.handleRate(3));
    this.scope.register([], "4", () => this.handleRate(4));
    // Esc: Modal's default keymap already closes on Escape.
  }

  private handleReveal() {
    if (!canReveal(this.session)) return;
    this.session = reveal(this.session);
    this.render();
  }

  private handleRate(rating: Rating) {
    if (!canRate(this.session)) return;
    const card = this.cardsByHash.get(currentCard(this.session)!.hash);
    const { session, updatedState } = rate(this.session, rating);
    this.session = session;
    void this.plugin.recordReview(updatedState.hash, updatedState, card?.reverseOf);
    this.render();
  }

  private render() {
    this.contentEl.empty();
    if (isComplete(this.session)) this.renderComplete();
    else this.renderCard();
  }

  private renderCard() {
    const state = currentCard(this.session);
    if (!state) return; // unreachable: render() already checked isComplete()
    const card = this.cardsByHash.get(state.hash);
    if (!card) return; // unreachable: cardsByHash is built from the same due set
    const progress = sessionProgress(this.session);

    this.titleEl.setText(`${card.deck} — ${progress.reviewed + 1} of ${progress.total}`);

    this.contentEl.createDiv({ cls: "flowcards-context", text: card.context });

    const frontEl = this.contentEl.createDiv({ cls: "flowcards-front" });
    void MarkdownRenderer.render(this.app, card.front, frontEl, card.notePath, this.mdComponent);

    if (!this.session.revealed) {
      new ButtonComponent(this.contentEl)
        .setButtonText("Show answer")
        .setCta()
        .onClick(() => this.handleReveal());
      return;
    }

    this.contentEl.createEl("hr");
    const backEl = this.contentEl.createDiv({ cls: "flowcards-back" });
    void MarkdownRenderer.render(this.app, card.back, backEl, card.notePath, this.mdComponent);

    const ratingRow = this.contentEl.createDiv({ cls: "flowcards-ratings" });
    const buttons: [Rating, string][] = [
      [1, "Again"],
      [2, "Hard"],
      [3, "Good"],
      [4, "Easy"],
    ];
    for (const [rating, label] of buttons) {
      new ButtonComponent(ratingRow)
        .setButtonText(`${label} (${rating})`)
        .onClick(() => this.handleRate(rating));
    }
  }

  private renderComplete() {
    const progress = sessionProgress(this.session);
    this.titleEl.setText("Review complete");
    this.contentEl.createEl("p", { text: `Reviewed ${progress.total} card(s).` });
    new ButtonComponent(this.contentEl)
      .setButtonText("Close")
      .setCta()
      .onClick(() => this.close());
  }
}

/**
 * A normal workspace tab (not a Modal) so it stays open and can be linked
 * to from any note via obsidian://flowcards-decks (registered in onload()).
 * DOM-wiring glue only — counting and deck-tree structure come entirely
 * from decks.ts (buildDeckTree). Picking a node calls
 * plugin.startReview(node.path, onClose), passing this.render as the
 * close-callback so the counts refresh the moment the review Modal closes,
 * without needing to reopen or reload this view.
 */
class DecksView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private plugin: FlowcardsPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_DECKS;
  }

  getDisplayText(): string {
    return "Flowcards decks";
  }

  getIcon(): string {
    return "graduation-cap";
  }

  async onOpen() {
    this.render();
    this.addAction("refresh-cw", "Refresh", () => this.render());
    // A tab that was already open doesn't otherwise learn that
    // plugin.states/cardCache changed in the background (e.g. a note was
    // edited while this tab wasn't focused) -- refresh whenever it becomes
    // the active leaf again. This alone doesn't cover every case (e.g. the
    // settings tab isn't a workspace leaf at all), so the plugin also pushes
    // a refresh directly -- see registerDecksView()/notifyDecksChanged().
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf === this.leaf) this.render();
      }),
    );
    this.plugin.registerDecksView(this);
  }

  async onClose() {
    this.plugin.unregisterDecksView(this);
  }

  render = () => {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Decks" });

    const totalDue = dueCards(this.plugin.states).length;
    new ButtonComponent(contentEl)
      .setButtonText(`All decks (${totalDue} due)`)
      .setCta()
      .onClick(() => this.plugin.startReview(undefined, this.render));

    const tree = buildDeckTree(this.plugin.states, this.plugin.cardCache);
    if (!tree.length) {
      contentEl.createEl("p", { text: "No cards indexed yet." });
      return;
    }
    const list = contentEl.createDiv({ cls: "flowcards-deck-tree" });
    this.renderNodes(list, tree, 0);
  };

  private renderNodes(container: HTMLElement, nodes: DeckNode[], depth: number) {
    for (const node of nodes) {
      const row = container.createDiv({ cls: "flowcards-deck-row" });
      row.style.paddingLeft = `${depth * 1.25}em`;
      new ButtonComponent(row)
        .setButtonText(node.name)
        .onClick(() => this.plugin.startReview(node.path, this.render));
      this.renderBreakdown(row, node.dueByRating, node.totalCount);
      if (node.children.length) this.renderNodes(container, node.children, depth + 1);
    }
  }

  /** Colored again/hard/good/easy/new badges for the due cards in this
   *  deck, followed by the total card count. Replaces a plain "(due/total)"
   *  text label -- categories with zero cards are skipped entirely. */
  private renderBreakdown(container: HTMLElement, breakdown: RatingBreakdown, total: number) {
    const parts: [keyof RatingBreakdown, string, string][] = [
      ["again", "Again", "flowcards-rating-again"],
      ["hard", "Hard", "flowcards-rating-hard"],
      ["good", "Good", "flowcards-rating-good"],
      ["easy", "Easy", "flowcards-rating-easy"],
      ["new", "New", "flowcards-rating-new"],
    ];
    for (const [key, label, cls] of parts) {
      const count = breakdown[key];
      if (count === 0) continue;
      container.createSpan({ cls: ["flowcards-rating-badge", cls], text: `${label} ${count}` });
    }
    container.createSpan({ cls: "flowcards-deck-total", text: `| ${total}` });
  }
}

/** Second confirmation hurdle before wiping every card's scheduling
 *  history -- deliberately not a one-click action from the settings tab. */
class ConfirmResetModal extends Modal {
  constructor(app: App, private onConfirm: () => void) {
    super(app);
  }

  onOpen() {
    this.titleEl.setText("Reset all learning progress?");
    this.contentEl.createEl("p", {
      text:
        "This permanently deletes scheduling history (ease, interval, " +
        "review log) for every card in your vault. This cannot be undone.",
    });
    const row = this.contentEl.createDiv({ cls: "flowcards-confirm-row" });
    new ButtonComponent(row).setButtonText("Cancel").onClick(() => this.close());
    new ButtonComponent(row)
      .setButtonText("Reset everything")
      .setWarning()
      .onClick(() => {
        this.close();
        this.onConfirm();
      });
  }
}

class FlowcardsSettingTab extends PluginSettingTab {
  private dirty = false;

  constructor(app: App, private plugin: FlowcardsPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    this.dirty = false;

    new Setting(containerEl)
      .setName("Deck tag root")
      .setDesc("Tag prefix that marks notes containing cards, e.g. flashcards")
      .addText((t) =>
        t.setValue(this.plugin.settings.deckTagRoot).onChange((v) => {
          this.plugin.settings.deckTagRoot = v.trim();
          this.dirty = true;
        }),
      );

    new Setting(containerEl)
      .setName("Reverse emoji")
      .setDesc("Marks a Q&A card as reversible")
      .addText((t) =>
        t.setValue(this.plugin.settings.reverseEmoji).onChange((v) => {
          this.plugin.settings.reverseEmoji = v.trim();
          this.dirty = true;
        }),
      );

    new Setting(containerEl)
      .setName("Callout type")
      .setDesc("Only callouts of this type (e.g. [!card]) become cards")
      .addText((t) =>
        t.setValue(this.plugin.settings.calloutType).onChange((v) => {
          this.plugin.settings.calloutType = v.trim();
          this.dirty = true;
        }),
      );

    new Setting(containerEl).setName("Cloze: highlight (==...==)").addToggle((tg) =>
      tg.setValue(this.plugin.settings.cloze.highlight).onChange((v) => {
        this.plugin.settings.cloze.highlight = v;
        this.dirty = true;
      }),
    );

    new Setting(containerEl).setName("Cloze: bold (**...**)").addToggle((tg) =>
      tg.setValue(this.plugin.settings.cloze.bold).onChange((v) => {
        this.plugin.settings.cloze.bold = v;
        this.dirty = true;
      }),
    );

    new Setting(containerEl)
      .setName("Cloze scope")
      .setDesc(
        "Where cloze markers count as cards. Callouts are always card " +
          "candidates either way — this only controls loose clozes in the " +
          "rest of the note.",
      )
      .addDropdown((d) =>
        d
          .addOption("anywhere", "Whole note")
          .addOption("callout-only", "Inside callouts only")
          .setValue(this.plugin.settings.cloze.scope)
          .onChange((v) => {
            this.plugin.settings.cloze.scope = v as ClozeScope;
            this.dirty = true;
          }),
      );

    containerEl.createEl("h3", { text: "Danger zone" });
    new Setting(containerEl)
      .setName("Reset all learning progress")
      .setDesc("Deletes every card's scheduling history and starts fresh. This cannot be undone.")
      .addButton((btn) =>
        btn
          .setButtonText("Reset everything")
          .setWarning()
          .onClick(() => {
            new ConfirmResetModal(this.app, async () => {
              await this.plugin.resetAllProgress();
              new Notice("Flowcards: all learning progress has been reset.");
            }).open();
          }),
      );
  }

  /** Fires when the user navigates away from this settings tab. Persist +
   *  reindex exactly once here rather than per keystroke/click — see
   *  FlowcardsPlugin.saveSettings(). No-op if nothing actually changed. */
  hide(): void {
    if (this.dirty) void this.plugin.saveSettings();
  }
}
