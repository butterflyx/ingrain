import { App, Notice, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";
import {
  DEFAULT_SETTINGS,
  FlowcardsSettings,
  PersistedData,
  StateMap,
} from "./types";
import { parseNote } from "./parser";
import {
  reconcileNote,
  renameNotePath,
  sweepOrphans,
  dueCards,
} from "./reconcile";

// This is the ONLY file that touches the Obsidian API. It stays thin on
// purpose: parse + reconcile + schedule are all pure and tested elsewhere.
// The review Modal (Milestone 3) plugs in where startReview() is stubbed.

export default class FlowcardsPlugin extends Plugin {
  settings: FlowcardsSettings = DEFAULT_SETTINGS;
  states: StateMap = {};

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
    await this.save();
  }

  private async rebuildIndex() {
    const live = new Set<string>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const md = await this.app.vault.cachedRead(file);
      const cards = parseNote(md, file.path, this.settings);
      const result = reconcileNote(cards, this.states, file.path);
      this.states = result.states;
      for (const c of cards) live.add(c.hash);
    }
    this.states = sweepOrphans(this.states, live).states;
    await this.save();
  }

  private startReview() {
    const due = dueCards(this.states);
    // TODO Milestone 3: open the review Modal here.
    new Notice(`Flowcards: ${due.length} card(s) due.`);
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
  }
}
