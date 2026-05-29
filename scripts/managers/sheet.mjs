import {
   MODULE_ID,
   DC_BY_LEVEL,
   DEFAULT_SIEGE_ACTION_FLAGS,
} from "../constants.mjs"
import { clampLevel, isSiege, tKey } from "../utils.mjs"
import { SiegeSheetUI } from "../ui/sheet.mjs"
import { SiegePortableManager } from "./portable.mjs"

export class SiegeWeaponManager {
   static initHooks() {
      Hooks.on("renderActorSheet", (app, html, data) =>
         SiegeSheetUI.renderSheet(app, html, data),
      )
      Hooks.on("updateActor", (actor, changes, options, userId) =>
         this.onUpdateActor(actor, changes, options, userId),
      )
      Hooks.on("preUpdateActor", (actor, changes) => {
         if (!isSiege(actor)) return
         const newLevel = foundry.utils.getProperty(
            changes,
            "system.details.level.value",
         )
         if (newLevel === undefined || newLevel === null) return
         foundry.utils.setProperty(
            changes,
            `flags.${MODULE_ID}.disableDC`,
            DC_BY_LEVEL[clampLevel(newLevel)],
         )
      })
   }

   static async onUpdateActor(actor, changes, options, userId) {
      if (game.user.id !== userId || actor.type !== "vehicle") return

      if (
         foundry.utils.getProperty(changes, `flags.${MODULE_ID}.bulk`) !==
         undefined
      ) {
         await SiegePortableManager.syncPortableState(actor)
      }

      const traits = changes.system?.traits?.value
      if (traits && isSiege(actor)) {
         await this._syncPortableTrait(actor, traits)
      }

      const isSiegeChanged = foundry.utils.getProperty(
         changes,
         `flags.${MODULE_ID}.isSiegeWeapon`,
      )
      if (isSiegeChanged === true) {
         await this._initializeSiegeWeapon(actor)
      }
   }

   static async _syncPortableTrait(actor, traits) {
      if (traits.includes("portable")) {
         await SiegePortableManager.syncPortableState(actor)
         return
      }
      await SiegePortableManager._clearPortableMarkers(actor)
   }

   static async _initializeSiegeWeapon(actor) {
      const currentTraits = actor.system.traits?.value || []
      if (!currentTraits.includes("mounted")) {
         await actor.update({
            "system.traits.value": [...currentTraits, "mounted"],
         })
      }

      const loadName = tKey("ActionTemplates.Load.Name")
      const hasLoading = actor.items.some(
         (i) => i.type === "action" && i.name === loadName,
      )
      if (hasLoading) return

      await actor.createEmbeddedDocuments("Item", [
         {
            name: loadName,
            type: "action",
            system: {
               description: {
                  value: tKey("ActionTemplates.Load.FullDesc"),
               },
               actionType: { value: "action" },
               actions: { value: 1 },
               traits: { value: ["manipulate"] },
            },
            flags: {
               [MODULE_ID]: {
                  siegeAction: {
                     ...DEFAULT_SIEGE_ACTION_FLAGS,
                     skills: [{ name: "athletics", loreName: "", dc: "" }],
                  },
               },
            },
         },
      ])
      ui.notifications.info(tKey("Notifications.ConvertedToSiege", { name: actor.name }))
   }
}
