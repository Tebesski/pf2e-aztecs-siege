import { MODULE_ID } from "../constants.mjs"
import { tKey } from "../utils.mjs"
import { SiegeSFXManager } from "./sfx.mjs"
import { ActionsHotkeyPanel } from "../ui/actions-hotkey-panel.mjs"






export class SiegeKeybindings {
   static initHooks() {
      Hooks.once("init", () => this.register())
   }

   static register() {
      game.keybindings.register(MODULE_ID, "openVehicleStash", {
         name: tKey("Keybindings.OpenStash.Name"),
         hint: tKey("Keybindings.OpenStash.Hint"),
         editable: [{ key: "KeyI" }],
         onDown: () => {
            this._openStash()
            return true
         },
      })

      game.keybindings.register(MODULE_ID, "openCrewHUD", {
         name: tKey("Keybindings.OpenCrewHUD.Name"),
         hint: tKey("Keybindings.OpenCrewHUD.Hint"),
         editable: [{ key: "KeyH" }],
         onDown: () => {
            this._openCrewHUD()
            return true
         },
      })

      game.keybindings.register(MODULE_ID, "openVehicleHUD", {
         name: tKey("Keybindings.OpenVehicleHUD.Name"),
         hint: tKey("Keybindings.OpenVehicleHUD.Hint"),
         editable: [{ key: "KeyV" }],
         onDown: () => {
            this._openVehicleHUD()
            return true
         },
      })

      game.keybindings.register(MODULE_ID, "openActionsPanel", {
         name: tKey("Keybindings.OpenActionsPanel.Name"),
         hint: tKey("Keybindings.OpenActionsPanel.Hint"),
         editable: [{ key: "KeyL" }],
         onDown: () => {
            this._openActionsPanel()
            return true
         },
      })
   }

   
   
   static _resolveVehicle() {
      const targets = Array.from(game.user.targets)
      const targetVeh = targets.find((t) => t.actor?.type === "vehicle")
      if (targetVeh) return targetVeh.actor

      const controlled = canvas?.tokens?.controlled || []
      const ctrlVeh = controlled.find((t) => t.actor?.type === "vehicle")
      if (ctrlVeh) return ctrlVeh.actor

      
      const crewman = controlled[0]?.actor || game.user.character
      if (crewman) {
         const eff = crewman.itemTypes.effect.find(
            (e) =>
               e.getFlag(MODULE_ID, "siegeId"),
         )
         if (eff) {
            const v = game.actors.get(eff.getFlag(MODULE_ID, "siegeId"))
            if (v) return v
         }
      }
      return null
   }

   
   
   static _resolveVehicleForHud() {
      const vehicle = this._resolveVehicle()
      if (!vehicle) return null
      if (game.user.isGM) return vehicle
      const isInside = (vehicle.getFlag(MODULE_ID, "crew") || []).length
         ? this._userIsCrewOfVehicle(vehicle)
         : false
      if (!isInside) {
         ui.notifications.warn(tKey("Keybindings.MustBeAboard"))
         return null
      }
      return vehicle
   }

   
   static _userIsCrewOfVehicle(vehicle) {
      const candidates = new Set()
      const ctrl = canvas?.tokens?.controlled || []
      for (const t of ctrl) if (t.actor) candidates.add(t.actor)
      if (game.user.character) candidates.add(game.user.character)
      for (const actor of candidates) {
         const eff = actor.itemTypes?.effect?.find(
            (e) =>
               e.getFlag(MODULE_ID, "siegeId") === vehicle.id,
         )
         if (eff) return true
      }
      return false
   }

   static async _openVehicleHUD() {
      const vehicle = this._resolveVehicleForHud()
      if (!vehicle)
         return ui.notifications.warn(tKey("Keybindings.NoVehicleResolved"))
      const { VehicleHUD } = await import("../ui/vehicle-hud.mjs")
      const existing = VehicleHUD._open.get(vehicle.id)
      if (existing && existing.tab === "details") {
         existing.close()
         return
      }
      const hud = VehicleHUD.open(vehicle)
      if (hud) {
         hud.tab = "details"
         hud.render({ force: false })
      }
   }

   static async _openStash() {
      const vehicle = this._resolveVehicleForHud()
      if (!vehicle)
         return ui.notifications.warn(tKey("Keybindings.NoVehicleResolved"))
      const { VehicleHUD } = await import("../ui/vehicle-hud.mjs")
      
      const existing = VehicleHUD._open.get(vehicle.id)
      if (existing && existing.tab === "stash") {
         existing.close()
         return
      }
      const hud = VehicleHUD.open(vehicle)
      if (hud) {
         SiegeSFXManager.playIfConfigured(vehicle, "openStash")
         hud.tab = "stash"
         hud.render({ force: false })
      }
   }

   static async _openCrewHUD() {
      const vehicle = this._resolveVehicleForHud()
      if (!vehicle)
         return ui.notifications.warn(tKey("Keybindings.NoVehicleResolved"))
      const { CrewHUD } = await import("../ui/crew-hud.mjs")
      
      const existing = CrewHUD._open.get(vehicle.id)
      if (existing) {
         existing.close()
         return
      }
      CrewHUD.open(vehicle)
   }

   static async _openActionsPanel() {
      const vehicle = this._resolveVehicleForHud()
      if (!vehicle)
         return ui.notifications.warn(tKey("Keybindings.NoVehicleResolved"))
      ActionsHotkeyPanel.toggle(vehicle)
   }
}
