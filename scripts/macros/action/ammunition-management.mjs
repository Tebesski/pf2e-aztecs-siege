import { MODULE_ID } from "../../constants.mjs"
import { renderHbs, tKey, tplPath } from "../../utils.mjs"
import { actionDisabledReason } from "../helpers.mjs"
import {
   advanceLoadProgressOrReady,
   clearLoadProgressAfterLoad,
   canAttemptWeaponReload,
} from "../action-roll.mjs"
import { AmmunitionManager } from "../../managers/ammunition.mjs"
import { SiegeSocketManager } from "../../managers/sockets.mjs"
import { ammoTypesAccordionHTML } from "../../ui/ammo-details.mjs"

function _ammoStrikeActions(siege) {
   if (!siege?.items) return []
   return siege.items.filter((item) => {
      if (item.type !== "action") return false
      const flag = item.getFlag(MODULE_ID, "siegeAction") || {}
      if (!(flag.isStrike || flag.isAttack) || flag.usesAmmunition === false)
         return false
      return AmmunitionManager.ammoTypesForAction(siege, flag).length > 0
   })
}

async function _reloadWeaponFromActions(siege, crewman, action) {
   const flag = action.getFlag(MODULE_ID, "siegeAction") || {}
   if (!(await canAttemptWeaponReload(siege, action, crewman))) return false
   const progress = await advanceLoadProgressOrReady(siege, action, flag)
   if (!progress.ready) return true

   const active = AmmunitionManager.getActiveLoadedPiece(siege, action)
   const usesCharges = !!active?.usesCharges
   const multiType =
      AmmunitionManager.ammoSlugsForAction(
         action.getFlag(MODULE_ID, "siegeAction") || {},
      ).length > 1
   const amount =
      usesCharges || multiType
         ? null
         : await _promptWeaponAmount(siege, crewman, action, "reload")
   if (!usesCharges && !multiType && amount === null) return false
   const success = await SiegeSocketManager.reloadStrike(siege, action, amount, {
      crewmanUuid: crewman?.uuid,
      useAdjacent: true,
   })
   if (success) await clearLoadProgressAfterLoad(siege, action, flag)
   return success
}

async function _unloadWeaponFromActions(siege, crewman, action) {
   const active = AmmunitionManager.getActiveLoadedPiece(siege, action)
   const usesCharges = !!active?.usesCharges
   const amount = usesCharges
      ? null
      : await _promptWeaponAmount(siege, crewman, action, "unload")
   if (!usesCharges && amount === null) return false
   return SiegeSocketManager.unloadStrike(siege, action, amount)
}

async function _manageWeaponAmmunitionFromActions(siege, crewman, action) {
   const choice = await _promptWeaponAmmunitionManagement(siege, action)
   if (!choice) return false
   return _runWeaponAmmunitionChoice(siege, crewman, action, choice)
}

async function _runWeaponAmmunitionChoice(siege, crewman, action, choice) {
   if (choice === "reload") return _reloadWeaponFromActions(siege, crewman, action)
   if (choice === "switch")
      return _switchWeaponFromActions(siege, action)
   if (choice === "unload")
      return _unloadWeaponFromActions(siege, crewman, action)
   return false
}

async function _manageAmmunitionFromLoadAction(siege, crewman) {
   const actions = _ammoStrikeActions(siege)
   if (actions.length === 0) {
      ui.notifications.warn(tKey("Notifications.NoAvailableActions"))
      return false
   }
   const action =
      actions.length === 1
         ? actions[0]
         : await _promptWeaponForAmmunitionManagement(siege, actions)
   if (!action) return false
   return _manageWeaponAmmunitionFromActions(siege, crewman, action)
}

async function _promptWeaponForAmmunitionManagement(siege, actions) {
   const escape = (value) =>
      foundry.utils.escapeHTML?.(String(value ?? "")) ?? String(value ?? "")
   const options = actions
      .map(
         (action) =>
            `<option value="${escape(action.id)}">${escape(action.name)}</option>`,
      )
      .join("")
   const pickedId = await foundry.applications.api.DialogV2.wait({
      classes: ["siege-v2-dialog"],
      window: { title: tKey("Weaponry.ManageAmmunitionTitle", { name: siege.name }) },
      content: `<div class="form-group stacked">
         <label>${tKey("Load.Strike")}</label>
         <select class="siege-manage-ammo-weapon">${options}</select>
      </div>`,
      buttons: [
         {
            action: "ok",
            label: tKey("Buttons.Confirm"),
            default: true,
            callback: (event, button, dialog) => {
               const root = dialog?.element ?? button?.form ?? document
               return root.querySelector(".siege-manage-ammo-weapon")?.value
            },
         },
         {
            action: "cancel",
            label: tKey("Buttons.Cancel"),
            callback: () => null,
         },
      ],
   }).catch(() => null)
   return pickedId ? actions.find((action) => action.id === pickedId) || null : null
}

async function _switchWeaponFromActions(siege, action) {
   const flag = action.getFlag(MODULE_ID, "siegeAction") || {}
   if (!AmmunitionManager.canSwitchLoadedAmmo(siege, action)) {
      ui.notifications.info(tKey("Weaponry.NoAlternateLoadedAmmo"))
      return false
   }
   const progress = await advanceLoadProgressOrReady(siege, action, flag)
   if (!progress.ready) return true
   const success = await SiegeSocketManager.switchLoadedAmmo(siege, action)
   if (success) await clearLoadProgressAfterLoad(siege, action, flag)
   return success
}

async function _promptWeaponAmmunitionManagement(siege, action) {
   return new Promise((resolve) => {
      let settled = false
      class WeaponAmmunitionManagementApp extends foundry.applications.api.ApplicationV2 {
         static DEFAULT_OPTIONS = {
            classes: [
               "siege-v2-app",
               "siege-actions-app",
               "siege-ammo-manage-app",
            ],
            window: {
               title: tKey("Weaponry.ManageAmmunitionTitle", {
                  name: action?.name || "",
               }),
            },
            position: { width: 520, height: "auto" },
         }

         async _renderHTML() {
            return _weaponAmmunitionManagementHTML(siege, action)
         }

         _replaceHTML(result, content) {
            content.innerHTML = result
         }

         _onRender() {
            const root = this.element
            root
               ?.querySelectorAll?.("[data-ammo-manage-choice]")
               ?.forEach((button) => {
                  button.addEventListener("click", (event) => {
                     event.preventDefault()
                     this._settle(button.dataset.ammoManageChoice || null)
                  })
               })
            root
               ?.querySelector?.("[data-ammo-manage-cancel]")
               ?.addEventListener("click", (event) => {
                  event.preventDefault()
                  this._settle(null)
               })
         }

         _settle(value) {
            if (settled) return
            settled = true
            resolve(value)
            this.close()
         }

         _onClose(options) {
            if (!settled) {
               settled = true
               resolve(null)
            }
            return super._onClose(options)
         }
      }

      new WeaponAmmunitionManagementApp().render(true)
   })
}

function _weaponAmmunitionManagementHTML(siege, action) {
   const loaded = Math.max(
      AmmunitionManager.getStrikeLoaded(siege, action),
      AmmunitionManager.getLoadedAmmoPieces(siege, action).length,
   )
   const max = AmmunitionManager.strikeMaxLoaded(action)
   const active = AmmunitionManager.getActiveLoadedPiece(siege, action)
   const ammoLabel =
      loaded > 0
         ? active?.name ||
           AmmunitionManager.activeAmmoLabel(siege, action) ||
           tKey("Ammunition.TypeUnassigned")
         : tKey("Weaponry.UnloadedState")
   const canSwitch = AmmunitionManager.canSwitchLoadedAmmo(siege, action)
   const canUnload = loaded > 0
   return renderHbs(tplPath("macros/weapon-ammunition-management.hbs"), {
      loadedStatus: tKey("Weaponry.LoadedSimple", {
         loaded,
         max,
         ammo: ammoLabel,
      }),
      chooseActionLabel: tKey("Weaponry.ChooseAmmunitionAction"),
      reloadLabel: tKey("Weaponry.Reload"),
      switchLabel: tKey("Weaponry.SwitchLoaded"),
      unloadLabel: tKey("Weaponry.Unload"),
      availableAmmunitionLabel: tKey("Weaponry.AvailableAmmunition"),
      ammoTypesHtml: ammoTypesAccordionHTML(siege, action, { showLoaded: false }),
      cancelLabel: tKey("Buttons.Cancel"),
      canSwitch,
      canUnload,
   })
}

async function _promptWeaponAmount(siege, crewman, action, mode) {
   const flag = action.getFlag(MODULE_ID, "siegeAction") || {}
   const slug =
      mode === "reload"
         ? AmmunitionManager.primaryAmmoSlugForAction(flag)
         : AmmunitionManager.activeAmmoSlug(siege, action)
   const max = parseInt(flag.maxLoaded) || 1
   const loaded = AmmunitionManager.getStrikeLoaded(siege, action)
   let cap
   let def
   if (mode === "reload") {
      if (!slug || !AmmunitionManager.ammoTypeFor(siege, slug)) {
         ui.notifications.warn(tKey("Notifications.UnassignedAmmo"))
         return null
      }
      const replacingCharged =
         AmmunitionManager.reloadNeedsChargedReplacement(siege, action)
      const sources = await AmmunitionManager.collectLoadSources(siege, crewman, {
         includeAdjacent: true,
      })
      const avail = AmmunitionManager.ammoUsesCharges(siege, slug)
         ? AmmunitionManager.getAvailableLoadUnitsFromSources(siege, slug, sources)
         : sources.reduce(
              (sum, source) =>
                 sum + AmmunitionManager.getAvailableUnitsForSource(source, slug, siege),
              0,
           )
      cap = replacingCharged ? Math.min(1, avail) : Math.min(max - loaded, avail)
      def = cap
      if (cap <= 0) {
         ui.notifications.warn(tKey("Notifications.InsufficientAmmo"))
         return null
      }
   } else {
      cap = loaded
      def = loaded
      if (cap <= 0) {
         ui.notifications.info(tKey("Weaponry.NothingLoaded"))
         return null
      }
   }
   const title =
      mode === "reload" ? tKey("Weaponry.Reload") : tKey("Weaponry.Unload")
   const label =
      mode === "reload"
         ? tKey("Weaponry.ReloadAmount", { max: cap })
         : tKey("Weaponry.UnloadAmount", { max: cap })
   const result = await foundry.applications.api.DialogV2.wait({
      classes: ["siege-v2-dialog"],
      window: { title: `${title} - ${action.name}` },
      content: await renderHbs(tplPath("macros/weapon-amount-dialog.hbs"), {
         label,
         value: def,
         max: cap,
      }),
      buttons: [
         {
            action: "ok",
            label: title,
            default: true,
            callback: (event, button, dialog) => {
               const root = dialog?.element ?? button?.form ?? document
               const value =
                  root?.querySelector?.(".vh-amount-input")?.value ??
                  document.querySelector(".vh-amount-input")?.value
               return Math.max(1, Math.min(cap, parseInt(value) || 1))
            },
         },
         {
            action: "cancel",
            label: tKey("Buttons.Cancel"),
            callback: () => null,
         },
      ],
   }).catch(() => null)
   return typeof result === "number" ? result : null
}

export {
   _ammoStrikeActions,
   _manageAmmunitionFromLoadAction,
   _manageWeaponAmmunitionFromActions,
   _runWeaponAmmunitionChoice,
}
