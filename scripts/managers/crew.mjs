import { MODULE_ID } from "../constants.mjs"
import {
   isSiege,
   renderHbs,
   tplPath,
   tKey,
   buildStrikeRules,
} from "../utils.mjs"
import { SiegePortableManager } from "./portable.mjs"

export class SiegeCrewManager {
   static initHooks() {
      Hooks.on("renderActorSheet", (app, html, data) =>
         this._renderCrewTab(app, html, data),
      )
   }

   static async dismountCrewman(crewman, siege) {
      if (!crewman || !siege) return false
      const positionEffect = crewman.items.find(
         (i) =>
            i.type === "effect" &&
            i.getFlag(MODULE_ID, "siegeId") === siege.id &&
            i.getFlag(MODULE_ID, "position"),
      )
      if (positionEffect) {
         await positionEffect.delete()
         return true
      }
      const ids = crewman.items
         .filter((i) => i.getFlag(MODULE_ID, "siegeId") === siege.id)
         .map((i) => i.id)
      if (ids.length === 0) return false
      await crewman.deleteEmbeddedDocuments("Item", ids, {
         siegeDropCascade: true,
      })
      await SiegePortableManager.syncPortableState(siege)
      return true
   }

   static async _renderCrewTab(app, html, data) {
      if (!isSiege(app.document)) return

      const crewTab = html.find('.tab.crew[data-tab="crew"]')
      if (crewTab.length === 0) return

      crewTab.empty()
      const crew = app.document.getFlag(MODULE_ID, "crew") || []
      const htmlContent = await renderHbs(tplPath("sheet/crew-tab.hbs"), { crew })
      crewTab.append(htmlContent)

      this._bindCrewListeners(app, crewTab)
   }

   static _bindCrewListeners(app, crewTab) {
      const getCrew = () => app.document.getFlag(MODULE_ID, "crew") || []
      const saveCrew = (data) =>
         app.document.setFlag(MODULE_ID, "crew", data)

      crewTab.find(".add-crew").on("click", async (e) => {
         e.preventDefault()
         const current = getCrew()
         current.push({ title: tKey("Crew.NewPosition"), min: 1, max: 1 })
         await saveCrew(current)
      })

      crewTab.find(".remove-crew").on("click", async (e) => {
         e.preventDefault()
         const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: tKey("Crew.RemoveTitle") },
            content: `<p>${tKey("Crew.RemoveConfirm")}</p>`,
            rejectClose: false,
         })
         if (!confirmed) return

         const idx = $(e.currentTarget).closest(".crew-row").data("index")
         const current = getCrew()
         current.splice(idx, 1)
         await saveCrew(current)
      })

      crewTab.find(".crew-icon-img").on("click", async (e) => {
         e.preventDefault()
         const idx = $(e.currentTarget).closest(".crew-row").data("index")
         const current = getCrew()
         new foundry.applications.apps.FilePicker.implementation({
            type: "image",
            current: current[idx].icon || "icons/svg/mystery-man.svg",
            callback: async (path) => {
               current[idx].icon = path
               await saveCrew(current)
            },
         }).browse()
      })

      crewTab
         .find(".crew-title, .crew-min, .crew-max")
         .on("change", async (e) => {
            e.preventDefault()
            const row = $(e.currentTarget).closest(".crew-row")
            const idx = row.data("index")
            const current = getCrew()

            let minVal = parseInt(row.find(".crew-min").val()) || 1
            let maxVal = parseInt(row.find(".crew-max").val()) || 1

            if ($(e.currentTarget).hasClass("crew-min") && minVal > maxVal)
               maxVal = minVal
            if ($(e.currentTarget).hasClass("crew-max") && maxVal < minVal)
               minVal = maxVal

            current[idx].title = row.find(".crew-title").val()
            current[idx].min = minVal
            current[idx].max = maxVal
            await saveCrew(current)
         })
   }

   static async syncCrewEffects(siege) {
      if (!siege) return
      const actions = siege.items.filter((a) => a.type === "action")

      for (const actor of game.actors) {
         const effects = actor.itemTypes.effect.filter(
            (e) => e.getFlag(MODULE_ID, "siegeId") === siege.id,
         )

         for (const effect of effects) {
            const chosenPosition = effect.getFlag(MODULE_ID, "position")
            if (!chosenPosition) continue

            const rules = []
            for (const a of actions) {
               const flag = a.getFlag(MODULE_ID, "siegeAction")
               if (!flag || !flag.isStrike) continue
               if (
                  flag.crewAccess?.length > 0 &&
                  !flag.crewAccess.includes(chosenPosition)
               )
                  continue
               rules.push(...buildStrikeRules(siege, { ...flag, strikeLabel: a.name }))
            }
            await effect.update({ "system.rules": rules })
         }
      }
   }
}
