import { MODULE_ID } from "../constants.mjs"
import { renderHbs, tKey, tplPath } from "../utils.mjs"

export const SETTINGS = {
   APPLY_EXIT_ELEVATION: "applyExitElevation",
   PROMPT_EXIT_ELEVATION: "promptExitElevation",
   PROMPT_CONSEQUENCES: "promptConsequences",
   MODULE_TYPES: "moduleTypes",
}

class ModuleTypesConfig extends foundry.applications.api.ApplicationV2 {
   static DEFAULT_OPTIONS = {
      id: "siege-module-types-config",
      classes: ["siege-v2-app", "siege-module-types-config"],
      window: { title: "", frame: true, positioned: true },
      position: { width: 420, height: "auto" },
   }

   get title() {
      return tKey("Settings.ModuleTypes.Title")
   }

   _renderHTML() {
      const types = SiegeSettings.moduleTypes()
      return renderHbs(tplPath("apps/module-types-config.hbs"), {
         types: types.map((value, index) => ({ value, index })),
         labels: {
            hint: tKey("Settings.ModuleTypes.Hint"),
            add: tKey("Settings.ModuleTypes.Add"),
            save: tKey("Settings.ModuleTypes.Save"),
         },
      })
   }

   _replaceHTML(result, content) {
      content.innerHTML = result
   }

   _onRender() {
      const root = this.element
      root.querySelector(".siege-module-type-add")?.addEventListener("click", () => {
         const list = root.querySelector(".siege-module-type-list")
         const row = this._createModuleTypeRow(list.children.length)
         list.append(row)
         row.querySelector("input")?.focus()
         row.querySelector(".siege-module-type-remove")?.addEventListener("click", () => row.remove())
      })
      root.querySelectorAll(".siege-module-type-remove").forEach((button) =>
         button.addEventListener("click", () => button.closest(".siege-module-type-row")?.remove()),
      )
      root.querySelector(".siege-module-type-save")?.addEventListener("click", async () => {
         const types = [...root.querySelectorAll(".siege-module-type-input")]
            .map((input) => input.value.trim())
            .filter(Boolean)
         const unique = [...new Map(types.map((type) => [type.toLowerCase(), type])).values()]
         await game.settings.set(MODULE_ID, SETTINGS.MODULE_TYPES, unique)
         this.close()
      })
   }

   _createModuleTypeRow(index) {
      const row = document.createElement("div")
      row.className = "siege-module-type-row"
      row.dataset.index = String(index)
      const input = document.createElement("input")
      input.type = "text"
      input.className = "siege-module-type-input"
      const button = document.createElement("button")
      button.type = "button"
      button.className = "siege-module-type-remove"
      const icon = document.createElement("i")
      icon.className = "fa-solid fa-trash"
      button.append(icon)
      row.append(input, button)
      return row
   }
}

export class SiegeSettings {
   static initHooks() {
      Hooks.once("init", () => this.register())

Hooks.on("renderSettingsConfig", (app, html) => {
         try {
            const root = html instanceof HTMLElement ? html : html?.[0]
            if (!root) return
            const applyEl = root.querySelector(
               `[name="${MODULE_ID}.${SETTINGS.APPLY_EXIT_ELEVATION}"]`,
            )
            const promptEl = root.querySelector(
               `[name="${MODULE_ID}.${SETTINGS.PROMPT_EXIT_ELEVATION}"]`,
            )
            if (!applyEl || !promptEl) return
            const promptGroup = promptEl.closest(".form-group")
            const sync = () => {
               if (promptGroup)
                  promptGroup.style.display = applyEl.checked ? "" : "none"
            }
            sync()
            applyEl.addEventListener("change", sync)
         } catch (e) {
            
         }
      })
   }

   static register() {
      game.settings.registerMenu(MODULE_ID, "moduleTypesConfig", {
         name: tKey("Settings.ModuleTypes.Name"),
         label: tKey("Settings.ModuleTypes.Label"),
         hint: tKey("Settings.ModuleTypes.Hint"),
         icon: "fa-solid fa-kaaba",
         type: ModuleTypesConfig,
         restricted: true,
      })

      game.settings.register(MODULE_ID, SETTINGS.MODULE_TYPES, {
         name: tKey("Settings.ModuleTypes.Name"),
         hint: tKey("Settings.ModuleTypes.Hint"),
         scope: "world",
         config: false,
         type: Array,
         default: [],
      })

game.settings.register(MODULE_ID, SETTINGS.APPLY_EXIT_ELEVATION, {
         name: tKey("Settings.ApplyExitElevation.Name"),
         hint: tKey("Settings.ApplyExitElevation.Hint"),
         scope: "world",
         config: true,
         type: Boolean,
         default: false,
      })

game.settings.register(MODULE_ID, SETTINGS.PROMPT_EXIT_ELEVATION, {
         name: tKey("Settings.PromptExitElevation.Name"),
         hint: tKey("Settings.PromptExitElevation.Hint"),
         scope: "world",
         config: true,
         type: Boolean,
         default: true,
      })

      game.settings.register(MODULE_ID, SETTINGS.PROMPT_CONSEQUENCES, {
         name: tKey("Settings.PromptConsequences.Name"),
         hint: tKey("Settings.PromptConsequences.Hint"),
         scope: "world",
         config: true,
         type: Boolean,
         default: true,
      })
   }

   static get(key) {
      try {
         return game.settings.get(MODULE_ID, key)
      } catch {
         return undefined
      }
   }

   static applyExitElevation() {
      return !!this.get(SETTINGS.APPLY_EXIT_ELEVATION)
   }

   static promptExitElevation() {
      const v = this.get(SETTINGS.PROMPT_EXIT_ELEVATION)
      return v === undefined ? true : !!v
   }

   static promptConsequences() {
      const v = this.get(SETTINGS.PROMPT_CONSEQUENCES)
      return v === undefined ? true : !!v
   }

   static moduleTypes() {
      const value = this.get(SETTINGS.MODULE_TYPES)
      return Array.isArray(value) ? value.filter(Boolean) : []
   }
}
