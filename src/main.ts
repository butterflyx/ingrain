import {
  App,
  ButtonComponent,
  Component,
  MarkdownRenderer,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
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

// This is the ONLY file that touches the Obsidian API. It stays thin on
// purpose: parse + reconcile + schedule + the review session state machine
// are all pure and tested elsewhere; ReviewModal below only wires DOM to it.

export default class FlowcardsPlugin extends Plugin {
  settings: FlowcardsSettings = DEFAULT_SETTINGS;
  states: StateMap = {};
  /** hash -> most-recently-parsed Card content. NOT persisted; rebuilt from
   *  the vault on load/rebuild and kept current by indexFile(). Exists only
   *  so the review Modal can render front/back for due hashes, since
   *  CardState alone has no renderable content. */
  cardCache: Record<string, Card> = {};

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

    this.addSettingTab(new FlowcardsSettingTab(this.app, this));

    // Full sweep on load to purge states from deleted notes.
    this.app.workspace.onLayoutReady(() => void this.rebuildIndex());
  }

  onunload() {
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
  }

  private startReview() {
    const due = dueCards(this.states);
    if (!due.length) {
      new Notice("Flowcards: no cards due.");
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

    new ReviewModal(this.app, this, resolved, cardsByHash).open();
  }

  /** Persist the result of a single review. Write-through (not batched) so
   *  progress survives an app kill mid-session on mobile. */
  async recordReview(hash: string, state: CardState): Promise<void> {
    this.states = { ...this.states, [hash]: state };
    await this.save();
  }

  private async loadPersisted() {
    const data = (await this.loadData()) as PersistedData | null;
    if (data?.schema === 1) this.states = data.states;
    // settings are stored alongside in a real build; kept default for the scaffold.
  }

  private async save() {
    const data: PersistedData = { schema: 1, states: this.states };
    await this.saveData(data);
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
    const { session, updatedState } = rate(this.session, rating);
    this.session = session;
    void this.plugin.recordReview(updatedState.hash, updatedState);
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

class FlowcardsSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: FlowcardsPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Deck tag root")
      .setDesc("Tag prefix that marks notes containing cards, e.g. flashcards")
      .addText((t) =>
        t.setValue(this.plugin.settings.deckTagRoot).onChange(async (v) => {
          this.plugin.settings.deckTagRoot = v.trim();
        }),
      );

    new Setting(containerEl)
      .setName("Reverse emoji")
      .setDesc("Marks a Q&A card as reversible")
      .addText((t) =>
        t.setValue(this.plugin.settings.reverseEmoji).onChange(async (v) => {
          this.plugin.settings.reverseEmoji = v.trim();
        }),
      );

    new Setting(containerEl).setName("Cloze: highlight (==...==)").addToggle((tg) =>
      tg.setValue(this.plugin.settings.cloze.highlight).onChange((v) => {
        this.plugin.settings.cloze.highlight = v;
      }),
    );

    new Setting(containerEl).setName("Cloze: bold (**...**)").addToggle((tg) =>
      tg.setValue(this.plugin.settings.cloze.bold).onChange((v) => {
        this.plugin.settings.cloze.bold = v;
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
          }),
      );
  }
}
