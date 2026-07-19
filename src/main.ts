import {
  App,
  ButtonComponent,
  Component,
  Editor,
  ItemView,
  MarkdownRenderer,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  WorkspaceLeaf,
  moment,
} from "obsidian";
import {
  Card,
  CardState,
  ClozeScope,
  DEFAULT_SETTINGS,
  SiftSettings,
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
import { shouldShowReminder } from "./reminder";
import { Key, t } from "./i18n";

// This is the ONLY file that touches the Obsidian API. It stays thin on
// purpose: parse + reconcile + schedule + the review session state machine
// are all pure and tested elsewhere; ReviewModal/DecksView below only wire
// DOM to it.

const VIEW_TYPE_DECKS = "sift-decks-view";

export default class SiftPlugin extends Plugin {
  settings: SiftSettings = DEFAULT_SETTINGS;
  states: StateMap = {};
  /** Read once at onload() from moment.locale() -- Obsidian bundles moment
   *  and keeps its locale synced with Settings -> General -> Language, so
   *  this is the standard way plugins pick up the user's UI language
   *  without a dedicated language switcher. Only changes on Obsidian
   *  restart, so a one-time read is enough. */
  locale = "en";
  /** hash -> most-recently-parsed Card content. NOT persisted; rebuilt from
   *  the vault on load/rebuild and kept current by indexFile(). Exists only
   *  so the review Modal can render front/back for due hashes, since
   *  CardState alone has no renderable content. */
  cardCache: Record<string, Card> = {};
  /** ISO timestamp of the last time a review reminder was shown, or null.
   *  See reminder.ts shouldShowReminder(). */
  private lastReminderShown: string | null = null;
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
    this.locale = moment.locale();
    await this.loadPersisted();

    this.addCommand({
      id: "review-due",
      name: t(this.locale, "cmdReviewDue"),
      callback: () => this.startReview(),
    });

    this.addCommand({
      id: "rebuild-index",
      name: t(this.locale, "cmdRebuildIndex"),
      callback: () => this.rebuildIndex(),
    });

    this.addCommand({
      id: "browse-decks",
      name: t(this.locale, "cmdOpenDecks"),
      callback: () => void this.activateDecksView(),
    });

    this.addCommand({
      id: "insert-card-skeleton",
      name: t(this.locale, "cmdInsertSkeleton"),
      editorCallback: (editor: Editor) => {
        const type = this.settings.calloutType || "card";
        const prefix = `> [!${type}] `;
        const cursor = editor.getCursor();
        editor.replaceSelection(`${prefix}\n> \n`);
        editor.setCursor({ line: cursor.line, ch: prefix.length });
      },
    });

    this.addSettingTab(new SiftSettingTab(this.app, this));

    this.registerView(VIEW_TYPE_DECKS, (leaf) => new DecksView(leaf, this));
    // Lets a plain Markdown link -- [Decks](obsidian://sift-decks) --
    // open the deck overview from any note (e.g. a daily note), since
    // Obsidian wikilinks can only target real vault files, never a
    // plugin view without file backing.
    this.registerObsidianProtocolHandler("sift-decks", () => void this.activateDecksView());

    this.addRibbonIcon("graduation-cap", t(this.locale, "ribbonOpenDecks"), () => void this.activateDecksView());

    // Vault event listeners are registered here, not synchronously in
    // onload(), because Obsidian fires `create` for every existing file
    // during vault startup -- registering earlier would trigger a redundant
    // indexFile() per file on top of the full rebuildIndex() sweep below.
    this.app.workspace.onLayoutReady(() => {
      // Keep path metadata fresh on rename. Non-load-bearing: identity is
      // the content hash, so even a missed rename self-heals on the next
      // parse.
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

      // Full sweep on load to purge states from deleted notes.
      void this.rebuildIndex();
    });

    // Check once on load -- catches an interval that elapsed while
    // Obsidian was closed, since the timer below only fires while it's
    // running. Then re-check hourly; shouldShowReminder()'s own throttle
    // keeps this from re-notifying more than once a day.
    this.checkReminder();
    this.registerInterval(window.setInterval(() => this.checkReminder(), 60 * 60 * 1000));
  }

  /** Shows a Notice, clickable to the deck overview, if shouldShowReminder()
   *  says it's time (due cards exist, the configured interval has passed
   *  since the last real review, and we haven't already reminded today). */
  private checkReminder(): void {
    if (!shouldShowReminder(this.states, this.settings.reminderIntervalDays, this.lastReminderShown)) {
      return;
    }
    const due = dueCards(this.states).length;
    const notice = new Notice(t(this.locale, "noticeReminderDue", { count: due }), 10000);
    notice.noticeEl.addEventListener("click", () => void this.activateDecksView());
    this.lastReminderShown = new Date().toISOString();
    void this.save();
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
      new Notice(
        deckPath
          ? t(this.locale, "noticeNoCardsDueInDeck", { deck: deckPath })
          : t(this.locale, "noticeNoCardsDue"),
      );
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
      new Notice(t(this.locale, "noticeStillIndexing"));
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
      this.lastReminderShown = data.lastReminderShown ?? null;
    }
  }

  private async save() {
    const data: PersistedData = {
      schema: 1,
      states: this.states,
      settings: this.settings,
      lastReminderShown: this.lastReminderShown,
    };
    await this.saveData(data);
  }

  /** Persist settings-tab edits AND reindex the vault with them, so a
   *  changed calloutType/deckTagRoot/etc. takes effect without a manual
   *  "Rebuild index". Called once when the settings tab is closed (see
   *  SiftSettingTab.hide()), not per keystroke -- rebuildIndex()
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
    private plugin: SiftPlugin,
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
    const { session, updatedState } = rate(this.session, rating, new Date(), card?.reverseOf);
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

    this.titleEl.setText(
      t(this.plugin.locale, "reviewProgressTitle", {
        deck: card.deck,
        current: progress.reviewed + 1,
        total: progress.total,
      }),
    );

    this.contentEl.createDiv({ cls: "sift-context", text: card.context });

    const frontEl = this.contentEl.createDiv({ cls: "sift-front" });
    void MarkdownRenderer.render(this.app, card.front, frontEl, card.notePath, this.mdComponent);

    if (!this.session.revealed) {
      new ButtonComponent(this.contentEl)
        .setButtonText(t(this.plugin.locale, "reviewShowAnswer"))
        .setCta()
        .onClick(() => this.handleReveal());
      return;
    }

    this.contentEl.createEl("hr");
    const backEl = this.contentEl.createDiv({ cls: "sift-back" });
    void MarkdownRenderer.render(this.app, card.back, backEl, card.notePath, this.mdComponent);

    const ratingRow = this.contentEl.createDiv({ cls: "sift-ratings" });
    const buttons: [Rating, Key][] = [
      [1, "ratingAgain"],
      [2, "ratingHard"],
      [3, "ratingGood"],
      [4, "ratingEasy"],
    ];
    for (const [rating, key] of buttons) {
      new ButtonComponent(ratingRow)
        .setButtonText(`${t(this.plugin.locale, key)} (${rating})`)
        .onClick(() => this.handleRate(rating));
    }
  }

  private renderComplete() {
    const progress = sessionProgress(this.session);
    this.titleEl.setText(t(this.plugin.locale, "reviewComplete"));
    this.contentEl.createEl("p", { text: t(this.plugin.locale, "reviewedCount", { count: progress.total }) });
    new ButtonComponent(this.contentEl)
      .setButtonText(t(this.plugin.locale, "close"))
      .setCta()
      .onClick(() => this.close());
  }
}

/**
 * A normal workspace tab (not a Modal) so it stays open and can be linked
 * to from any note via obsidian://sift-decks (registered in onload()).
 * DOM-wiring glue only — counting and deck-tree structure come entirely
 * from decks.ts (buildDeckTree). Picking a node calls
 * plugin.startReview(node.path, onClose), passing this.render as the
 * close-callback so the counts refresh the moment the review Modal closes,
 * without needing to reopen or reload this view.
 */
class DecksView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private plugin: SiftPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_DECKS;
  }

  getDisplayText(): string {
    return t(this.plugin.locale, "decksViewTitle");
  }

  getIcon(): string {
    return "graduation-cap";
  }

  async onOpen() {
    this.render();
    this.addAction("refresh-cw", t(this.plugin.locale, "decksRefreshAction"), () => this.render());
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
    contentEl.createEl("h2", { text: t(this.plugin.locale, "decksHeading") });

    const totalDue = dueCards(this.plugin.states).length;
    new ButtonComponent(contentEl)
      .setButtonText(t(this.plugin.locale, "decksAllDue", { count: totalDue }))
      .setCta()
      .onClick(() => this.plugin.startReview(undefined, this.render));

    const tree = buildDeckTree(this.plugin.states, this.plugin.cardCache);
    if (!tree.length) {
      contentEl.createEl("p", { text: t(this.plugin.locale, "decksEmpty") });
      return;
    }
    const list = contentEl.createDiv({ cls: "sift-deck-tree" });
    this.renderNodes(list, tree, 0);
  };

  private renderNodes(container: HTMLElement, nodes: DeckNode[], depth: number) {
    for (const node of nodes) {
      const row = container.createDiv({ cls: "sift-deck-row" });
      row.style.setProperty("--sift-depth", String(depth));
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
    const parts: [keyof RatingBreakdown, Key, string][] = [
      ["again", "ratingAgain", "sift-rating-again"],
      ["hard", "ratingHard", "sift-rating-hard"],
      ["good", "ratingGood", "sift-rating-good"],
      ["easy", "ratingEasy", "sift-rating-easy"],
      ["new", "ratingNew", "sift-rating-new"],
    ];
    let anyShown = false;
    for (const [key, labelKey, cls] of parts) {
      const count = breakdown[key];
      if (count === 0) continue;
      const label = t(this.plugin.locale, labelKey);
      container.createSpan({ cls: ["sift-rating-badge", cls], text: `${label} ${count}` });
      anyShown = true;
    }
    if (!anyShown) container.createSpan({ cls: "sift-deck-none", text: "–" });
    container.createSpan({ cls: "sift-deck-total", text: `| ${total}` });
  }
}

/** Second confirmation hurdle before wiping every card's scheduling
 *  history -- deliberately not a one-click action from the settings tab. */
class ConfirmResetModal extends Modal {
  constructor(app: App, private locale: string, private onConfirm: () => void) {
    super(app);
  }

  onOpen() {
    this.titleEl.setText(t(this.locale, "confirmResetTitle"));
    this.contentEl.createEl("p", { text: t(this.locale, "confirmResetBody") });
    const row = this.contentEl.createDiv({ cls: "sift-confirm-row" });
    new ButtonComponent(row)
      .setButtonText(t(this.locale, "cancel"))
      .onClick(() => this.close());
    new ButtonComponent(row)
      .setButtonText(t(this.locale, "resetEverything"))
      .setWarning()
      .onClick(() => {
        this.close();
        this.onConfirm();
      });
  }
}

class SiftSettingTab extends PluginSettingTab {
  private dirty = false;

  constructor(app: App, private plugin: SiftPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    this.dirty = false;

    const locale = this.plugin.locale;

    new Setting(containerEl)
      .setName(t(locale, "deckTagRootName"))
      .setDesc(t(locale, "deckTagRootDesc"))
      .addText((txt) =>
        txt.setValue(this.plugin.settings.deckTagRoot).onChange((v) => {
          this.plugin.settings.deckTagRoot = v.trim();
          this.dirty = true;
        }),
      );

    new Setting(containerEl)
      .setName(t(locale, "reverseEmojiName"))
      .setDesc(t(locale, "reverseEmojiDesc"))
      .addText((txt) =>
        txt.setValue(this.plugin.settings.reverseEmoji).onChange((v) => {
          this.plugin.settings.reverseEmoji = v.trim();
          this.dirty = true;
        }),
      );

    new Setting(containerEl)
      .setName(t(locale, "calloutTypeName"))
      .setDesc(t(locale, "calloutTypeDesc"))
      .addText((txt) =>
        txt.setValue(this.plugin.settings.calloutType).onChange((v) => {
          this.plugin.settings.calloutType = v.trim();
          this.dirty = true;
        }),
      );

    new Setting(containerEl).setName(t(locale, "clozeHighlightName")).addToggle((tg) =>
      tg.setValue(this.plugin.settings.cloze.highlight).onChange((v) => {
        this.plugin.settings.cloze.highlight = v;
        this.dirty = true;
      }),
    );

    new Setting(containerEl).setName(t(locale, "clozeBoldName")).addToggle((tg) =>
      tg.setValue(this.plugin.settings.cloze.bold).onChange((v) => {
        this.plugin.settings.cloze.bold = v;
        this.dirty = true;
      }),
    );

    new Setting(containerEl)
      .setName(t(locale, "clozeScopeName"))
      .setDesc(t(locale, "clozeScopeDesc"))
      .addDropdown((d) =>
        d
          .addOption("anywhere", t(locale, "clozeScopeAnywhere"))
          .addOption("callout-only", t(locale, "clozeScopeCalloutOnly"))
          .setValue(this.plugin.settings.cloze.scope)
          .onChange((v) => {
            this.plugin.settings.cloze.scope = v as ClozeScope;
            this.dirty = true;
          }),
      );

    new Setting(containerEl)
      .setName(t(locale, "reminderName"))
      .setDesc(t(locale, "reminderDesc"))
      .addText((txt) =>
        txt.setValue(String(this.plugin.settings.reminderIntervalDays)).onChange((v) => {
          const n = parseInt(v, 10);
          this.plugin.settings.reminderIntervalDays = Number.isFinite(n) && n >= 0 ? n : 0;
          this.dirty = true;
        }),
      );

    containerEl.createEl("h3", { text: t(locale, "dangerZone") });
    new Setting(containerEl)
      .setName(t(locale, "resetName"))
      .setDesc(t(locale, "resetDesc"))
      .addButton((btn) =>
        btn
          .setButtonText(t(locale, "resetEverything"))
          .setWarning()
          .onClick(() => {
            new ConfirmResetModal(this.app, locale, async () => {
              await this.plugin.resetAllProgress();
              new Notice(t(locale, "noticeProgressReset"));
            }).open();
          }),
      );
  }

  /** Fires when the user navigates away from this settings tab. Persist +
   *  reindex exactly once here rather than per keystroke/click — see
   *  SiftPlugin.saveSettings(). No-op if nothing actually changed. */
  hide(): void {
    if (this.dirty) void this.plugin.saveSettings();
  }
}
