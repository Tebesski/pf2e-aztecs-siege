import { MODULE_ID } from "../constants.mjs"
import { tKey } from "../utils.mjs"

export const SETTINGS = {
   TAKE_AMMO_FROM_ADJACENT: "takeAmmoFromAdjacent",
   HAUL_DEBUG: "haulDebug",
   APPLY_EXIT_ELEVATION: "applyExitElevation",
   PROMPT_EXIT_ELEVATION: "promptExitElevation",
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
      game.settings.register(MODULE_ID, SETTINGS.TAKE_AMMO_FROM_ADJACENT, {
         name: tKey("Settings.TakeAmmoFromAdjacent.Name"),
         hint: tKey("Settings.TakeAmmoFromAdjacent.Hint"),
         scope: "world",
         config: true,
         type: Boolean,
         default: true,
      })

      game.settings.register(MODULE_ID, SETTINGS.HAUL_DEBUG, {
         name: tKey("Settings.HaulDebug.Name"),
         hint: tKey("Settings.HaulDebug.Hint"),
         scope: "world",
         config: true,
         type: Boolean,
         default: false,
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
   }

   static get(key) {
      try {
         return game.settings.get(MODULE_ID, key)
      } catch {
         return undefined
      }
   }

   
   
   static takeAmmoFromAdjacent() {
      const v = this.get(SETTINGS.TAKE_AMMO_FROM_ADJACENT)
      return v === undefined ? true : !!v
   }

   static applyExitElevation() {
      return !!this.get(SETTINGS.APPLY_EXIT_ELEVATION)
   }

   static promptExitElevation() {
      const v = this.get(SETTINGS.PROMPT_EXIT_ELEVATION)
      return v === undefined ? true : !!v
   }
}
