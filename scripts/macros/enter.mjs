import { MODULE_ID, DEFAULT_PERSON_IMG } from "../constants.mjs"
import { isSiege, renderHbs, tplPath, tKey, countOccupants } from "../utils.mjs"
import { VehicleEntryManager } from "../managers/entry.mjs"
import { buildPositionsData } from "./mount.mjs"
import { ensureSiegeCSS } from "./helpers.mjs"

export async function enterVehicleMacro(crewmanActor = null, vehicleActor = null) {
   let crewman = crewmanActor
   let vehicle = vehicleActor

   if (!crewman || !vehicle) {
      const controlled = canvas.tokens.controlled
      const targets = Array.from(game.user.targets)
      if (controlled.length !== 1 || targets.length !== 1)
         return ui.notifications.warn(tKey("Enter.Notifications.SelectOne"))
      crewman = controlled[0].actor
      vehicle = targets[0].actor
   }

   if (!VehicleEntryManager.isEnterable(vehicle))
      return ui.notifications.warn(tKey("Enter.Notifications.NotEnterable"))

const insideEffect = crewman.itemTypes.effect.find(
      (e) =>
         e.getFlag(MODULE_ID, "isEntered") &&
         e.getFlag(MODULE_ID, "siegeId") === vehicle.id,
   )
   if (insideEffect) {
      await VehicleEntryManager.exitVehicle(crewman, vehicle)
      return
   }

   const positions = vehicle.getFlag(MODULE_ID, "crew") || []
   if (positions.length === 0)
      return ui.notifications.warn(tKey("Notifications.NoCrewPositions"))

const positionsData = await buildPositionsData(vehicle, positions, () =>
      tKey("Enter.EnterButton"),
   )

   const htmlContent = await renderHbs(tplPath("macros/mount.hbs"), {
      positions: positionsData,
      i18n: { mountAs: tKey("Enter.EnterButton") },
   })

   class VehicleEnterApp extends foundry.applications.api.ApplicationV2 {
      static DEFAULT_OPTIONS = {
         classes: ["siege-v2-app", "siege-enter-app"],
         window: { title: tKey("Enter.Title", { name: vehicle.name }) },
         position: { width: 450, height: "auto" },
      }

      constructor(options) {
         super(options)
         ensureSiegeCSS()
      }

      _renderHTML() {
         return htmlContent
      }
      _replaceHTML(result, content) {
         content.innerHTML = result
      }
      _onRender() {
         this.element.querySelectorAll(".mount-btn").forEach((button) =>
            button.addEventListener("click", async (e) => {
               e.preventDefault()
               e.stopPropagation()
               const position = e.currentTarget?.dataset?.position
               await VehicleEntryManager.enterVehicle(crewman, vehicle, position)
               this.close()
            }),
         )
      }
   }

   new VehicleEnterApp().render(true)
}
