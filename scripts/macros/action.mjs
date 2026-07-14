import { MODULE_ID } from "../constants.mjs"
import {
   renderHbs,
   tplPath,
   tKey,
   findCrewmenOf,
   findLeaderEffect,
   formatProficiency,
   isSiegeLifted,
   siegeOffensiveEffectRuleUpdates,
} from "../utils.mjs"
import {
   getActionsForCrew,
   computeCrewStatus,
   ensureSiegeCSS,
   resolveActionDC,
   levelBasedActionDC,
   actionDisabledReason,
} from "./helpers.mjs"
import { repairMacro } from "./repair.mjs"
import { repairShieldsMacro } from "./repair-shields.mjs"
import { delegateWeightMacro } from "./delegate.mjs"
import { takeLeadershipMacro, delegateLeadershipMacro } from "./leadership.mjs"
import {
   resolveCrewman,
   resolveMountedSiege,
   buildI18nLabels,
   buildActionData,
} from "./action-build.mjs"
import {
   readRollContext,
   buildCustomOptions,
   calcDistance,
   validateRange,
   findMissingPrereqs,
   deductAmmo,
   hasSpendableAmmo,
   applyActionEffects,
   handleSkillRoll,
   handleAbilityAttack,
   handleStrike,
} from "./action-roll.mjs"
import { SiegeSFXManager } from "../managers/sfx.mjs"
import { AmmunitionManager } from "../managers/ammunition.mjs"
import { SiegeSocketManager } from "../managers/sockets.mjs"
import { SiegeCrewManager } from "../managers/crew.mjs"
import { applyConsequences } from "./consequences.mjs"
import {
   _ammoStrikeActions,
   _manageAmmunitionFromLoadAction,
   _manageWeaponAmmunitionFromActions,
} from "./action/ammunition-management.mjs"

const escapeHTML = (value) =>
   foundry.utils.escapeHTML?.(String(value ?? "")) ?? String(value ?? "")

export async function actionMacro(crewmanActor = null) {
   const crewman = crewmanActor || resolveCrewman()
   if (!crewman) return

   const mountInfo = await resolveMountedSiege(crewman)
   if (!mountInfo) return
   const { siege, position } = mountInfo

   const initialState = _buildDialogState(crewman, siege, position)
   if (initialState.actions.length === 0)
      return ui.notifications.warn(tKey("Notifications.NoAvailableActions"))

   class SiegeActionsApp extends foundry.applications.api.ApplicationV2 {
      static DEFAULT_OPTIONS = {
         classes: ["siege-v2-app", "siege-actions-app"],
         window: { title: tKey("ActionMacro.AppTitle", { name: siege.name }) },
         position: { width: 450, height: "auto" },
      }
      constructor(options) {
         super(options)
         ensureSiegeCSS()
         this._openDetails = new Set()
         this._refresh = foundry.utils.debounce(
            () => this.render({ force: false }),
            100,
         )
         this._hooks = []
         const on = (hook, fn) => {
            Hooks.on(hook, fn)
            this._hooks.push([hook, fn])
         }
         const itemChanged = (item) => {
            const parent = item?.parent
            if (parent?.id === siege.id || parent?.id === crewman.id)
               this._refresh()
         }
         const actorChanged = (actor) => {
            if (actor?.id === siege.id || actor?.id === crewman.id)
               this._refresh()
         }
         on("createItem", itemChanged)
         on("updateItem", itemChanged)
         on("deleteItem", itemChanged)
         on("updateActor", actorChanged)
      }
      async _renderHTML() {
         const state = _buildDialogState(crewman, siege, position)
         for (const row of state.renderData.actions)
            row.open = this._openDetails.has(row.id)
         for (const row of state.renderData.strikeActions)
            row.open = this._openDetails.has(row.id)
         for (const row of state.renderData.otherActions)
            row.open = this._openDetails.has(row.id)
         this._ctx = state.ctx
         return renderHbs(tplPath("macros/actions.hbs"), state.renderData)
      }
      _replaceHTML(result, content) {
         content.innerHTML = result
      }
      _onRender() {
         _bindAppListeners(this, this._ctx)
      }
      _onClose(options) {
         for (const [hook, fn] of this._hooks || []) Hooks.off(hook, fn)
         return super._onClose(options)
      }
   }

   new SiegeActionsApp().render(true)
}

function _buildDialogState(crewman, siege, position) {
   const isEnterableVehicle =
      siege.type === "vehicle" && !!siege.getFlag(MODULE_ID, "enterable")
   const vehicleNeedsIgnition = siege.getFlag(MODULE_ID, "needsIgnition") === true
   const vehicleLaunched = siege.itemTypes.effect.some((e) =>
      e.getFlag(MODULE_ID, "isLaunched"),
   )

   const { crewBlocked, shorthandedPenalty, missingCrewString, totalMissing } =
      computeCrewStatus(siege)
   const isPortable = (siege.system.traits?.value || []).includes("portable")
   const actions = getActionsForCrew(siege, position, crewman)
   const autoDC = levelBasedActionDC(crewman)

   const macroActionsData = actions.map((a) => {
      const data = buildActionData(a, siege, crewman, autoDC, isPortable)
      data.ignitionBlocked =
         isEnterableVehicle &&
         vehicleNeedsIgnition &&
         !vehicleLaunched &&
         data.needsIgnition
      return data
   })
   const strikeActions = macroActionsData.filter((a) => a.isStrike)
   const otherActions = macroActionsData.filter((a) => !a.isStrike)

   const mountedEffect = crewman.itemTypes.effect.find(
      (e) =>
         e.getFlag(MODULE_ID, "siegeId") === siege.id &&
         e.getFlag(MODULE_ID, "position"),
   )
   const isInside = !!(
      mountedEffect &&
      mountedEffect.getFlag(MODULE_ID, "isEntered")
   )
   const canUnmount = !!mountedEffect && !isInside && !isEnterableVehicle
   const leaveVehicleLabel = isInside
      ? tKey("CrewHUD.Exit")
      : tKey("CrewHUD.Unmount")
   const leaveVehicleIcon = isInside
      ? "fa-right-from-bracket"
      : "fa-person-walking-arrow-right"

   const myLiftedItem = isPortable
      ? crewman.items.find(
           (i) =>
              i.getFlag(MODULE_ID, "isLiftedItem") &&
              i.getFlag(MODULE_ID, "siegeId") === siege.id,
        )
      : null
   const myLiftBulk = myLiftedItem?.system?.bulk?.value || 0
   const isLifting = isPortable && myLiftBulk > 0

   const hasOtherCrew = findCrewmenOf(siege).some((a) => a.id !== crewman.id)
   const isLifted = isSiegeLifted(siege)
   const leaderEffect = findLeaderEffect(siege)
   const iAmLeader = leaderEffect?.parent?.id === crewman.id

   const renderData = {
      actions: macroActionsData,
      strikeActions,
      otherActions,
      hasStrikes: strikeActions.length > 0,
      hasOtherActions: otherActions.length > 0,
      isInside,
      showLeaveVehicle: isInside || canUnmount,
      leaveVehicleType: isInside ? "exit-vehicle" : "unmount-vehicle",
      leaveVehicleLabel,
      leaveVehicleIcon,
      siegeName: siege.name,
      repairDC: autoDC,
      crewBlocked,
      totalMissing,
      missingCrewString,
      shorthandedPenalty,
      isPortable,
      isLifting,
      myLiftBulk,
      showDelegateWeight: isLifting && hasOtherCrew,
      showTakeLeadership: isLifting && isLifted && !leaderEffect,
      showDelegateLeadership: isPortable && isLifted && iAmLeader && hasOtherCrew,
      i18n: buildI18nLabels(),
   }

   const ctx = {
      crewman,
      siege,
      position,
      isPortable,
      isEnterableVehicle,
      vehicleNeedsIgnition,
      crewBlocked,
      shorthandedPenalty,
      autoDC,
   }

   return { actions, renderData, ctx }
}

function _bindAppListeners(app, ctx) {
   const root = app.element
   if (!root) return

   root.querySelectorAll("details[data-action-id]").forEach((details) =>
      details.addEventListener("toggle", (e) => {
         const id = e.currentTarget?.dataset?.actionId
         if (!id || !app._openDetails) return
         if (e.currentTarget.open) app._openDetails.add(id)
         else app._openDetails.delete(id)
      }),
   )

   root.querySelectorAll(".roll-siege-btn").forEach((button) =>
      button.addEventListener("click", (e) => _handleRollClick(e, app, ctx)),
   )
}

async function _handleRollClick(e, app, ctx) {
   e.preventDefault()
   const btn = e.currentTarget
   if (!btn || btn.dataset.siegeBusy === "true") return false
   btn.dataset.siegeBusy = "true"
   btn.disabled = true
   try {
      const btnType = btn.dataset.type
      const {
         crewman,
         siege,
         isPortable,
         isEnterableVehicle,
         vehicleNeedsIgnition,
         crewBlocked,
         shorthandedPenalty,
         autoDC,
      } = ctx

      if (btnType === "repair") {
         const result = await repairMacro(crewman, siege)
         if (result !== false) return app.close()
         app.render?.({ force: false })
         return
      }
      if (btnType === "repair-shields") {
         const result = await repairShieldsMacro(crewman, siege)
         if (result !== false) return app.close()
         app.render?.({ force: false })
         return
      }
      if (btnType === "delegate-weight") {
         await delegateWeightMacro(crewman, siege)
         return app.close()
      }
      if (btnType === "take-leadership") {
         await takeLeadershipMacro(crewman, siege)
         return app.close()
      }
      if (btnType === "delegate-leadership") {
         await delegateLeadershipMacro(crewman, siege)
         return app.close()
      }
      if (btnType === "exit-vehicle") {
         const { VehicleEntryManager } = await import("../managers/entry.mjs")
         await VehicleEntryManager.exitVehicle(crewman, siege)
         return app.close()
      }
      if (btnType === "unmount-vehicle") {
         const removed = await SiegeCrewManager.dismountCrewman(crewman, siege)
         if (removed)
            ui.notifications.info(
               tKey("Notifications.CrewmanDismounted", {
                  crewman: crewman.name,
                  siege: siege.name,
               }),
            )
         return app.close()
      }

      const actionItem = siege.items.get(btn.dataset.item)
      if (!actionItem) return
      const disabledReason = actionDisabledReason(actionItem)
      if (disabledReason) {
         ui.notifications.warn(disabledReason)
         return
      }
      if (btnType === "linked-action") {
         await executeActionItem({
            event: e,
            app,
            crewman,
            siege,
            actionItem,
            buttonType: null,
            detailsBody: null,
            ctx,
         })
         app.render?.({ force: false })
         return
      }
      if (btnType === "weapon-manage-ammo") {
         await _manageWeaponAmmunitionFromActions(siege, crewman, actionItem)
         app.render?.({ force: false })
         return
      }
      if (btnType === "load-reload") {
         return executeActionItem({
            event: e,
            app,
            crewman,
            siege,
            actionItem,
            buttonType: null,
            detailsBody: btn.closest(".details-body"),
            ctx,
         })
      }
      return executeActionItem({
         event: e,
         app,
         crewman,
         siege,
         actionItem,
         buttonType: btnType,
         skillIdx: btn.dataset.skillidx,
         detailsBody: btn.closest(".details-body"),
         ctx,
      })
   } finally {
      delete btn.dataset.siegeBusy
      btn.disabled = false
   }
}
export async function executeActionItem({
   event = null,
   app = null,
   crewman,
   siege,
   actionItem,
   buttonType = null,
   skillIdx = null,
   detailsBody = null,
   preselectedLoadStrikeId = null,
   ctx = null,
} = {}) {
   if (!crewman || !siege || !actionItem) return false

   const disabledReason = actionDisabledReason(actionItem)
   if (disabledReason) {
      ui.notifications.warn(disabledReason)
      return false
   }

   const position = ctx?.position || _positionForCrewman(crewman, siege)
   const state = ctx || _buildDialogState(crewman, siege, position)
   const appShim =
      app || {
         close() {},
         render() {},
      }

   const rawFlag = actionItem.getFlag(MODULE_ID, "siegeAction") || {}
   if (rawFlag.isLightActivate) {
      if (state.crewBlocked) {
         ui.notifications.warn(tKey("Notifications.NotEnoughCrew"))
         return false
      }
      const { VehicleLightManager } = await import("../managers/lights.mjs")
      const activated = await VehicleLightManager.activateLight(
         siege,
         actionItem,
         crewman,
      )
      if (!activated) return false
      SiegeSFXManager.play(
         siege,
         activated.enabled === false
            ? `action-${actionItem.id}-off`
            : `action-${actionItem.id}`,
      )
      appShim.close?.()
      return true
   }
   if (rawFlag.isShieldActivate) {
      if (state.crewBlocked) {
         ui.notifications.warn(tKey("Notifications.NotEnoughCrew"))
         return false
      }
      const { VehicleShieldManager } = await import("../managers/shields.mjs")
      const activated = await VehicleShieldManager.activateShield(
         siege,
         actionItem,
         crewman,
      )
      if (activated) appShim.close?.()
      return activated
   }
   if (rawFlag.isRepairShields) {
      if (state.crewBlocked) {
         ui.notifications.warn(tKey("Notifications.NotEnoughCrew"))
         return false
      }
      const result = await repairShieldsMacro(crewman, siege)
      if (result !== false) appShim.close?.()
      return result !== false
   }
   if (rawFlag.isRepair || _isRepairAction(actionItem)) {
      if (state.crewBlocked) {
         ui.notifications.warn(tKey("Notifications.NotEnoughCrew"))
         return false
      }
      const result = await repairMacro(crewman, siege)
      if (result !== false) appShim.close?.()
      return result !== false
   }
   const isAmmoAttack =
      (rawFlag.isAttack || rawFlag.isStrike) &&
      rawFlag.usesAmmunition !== false
   const ammoPayload = isAmmoAttack
      ? AmmunitionManager.activeAmmoPayload(siege, actionItem)
      : null
   const flag = isAmmoAttack
      ? AmmunitionManager.applyAmmoOverridesToFlag(rawFlag, ammoPayload)
      : rawFlag
   const body = detailsBody || document.createElement("div")
   const eventObj = event?.originalEvent
      ? event
      : {
           originalEvent: event || new MouseEvent("click"),
           preventDefault() {},
           stopPropagation() {},
        }
   let btnType = buttonType

if (
      state.isEnterableVehicle &&
      state.vehicleNeedsIgnition &&
      flag.needsIgnition !== false
   ) {
      const { VehicleLaunchManager } = await import("../managers/launch.mjs")
      if (!VehicleLaunchManager.isLaunched(siege)) {
         ui.notifications.warn(tKey("CrewHUD.NotLaunched"))
         return false
      }
   }

   if (state.crewBlocked) {
      ui.notifications.warn(tKey("Notifications.NotEnoughCrew"))
      return false
   }

   const rollContext = readRollContext(body, flag)
   const customOptions = buildCustomOptions(
      siege,
      flag,
      rollContext.versatileTrait,
   )

   const isLoading =
      actionItem.name === tKey("ActionTemplates.Load.Name") ||
      actionItem.name === "Loading"
   if (!btnType) btnType = _defaultButtonType(actionItem, flag, isLoading)
   const isStrike = btnType === "strike"
   const skillGatesAbility =
      btnType === "skill" && flag.isAttack && !flag.isStrike

   const distance = calcDistance(siege, isStrike)
   if (isStrike && !validateRange(distance, flag)) return

   const missingPrereqs = findMissingPrereqs(siege, flag)
   if (missingPrereqs.length > 0) {
      ui.notifications.warn(
         tKey("Notifications.MissingPrereqs", {
            name: actionItem.name,
            list: missingPrereqs.map((p) => p.name).join(", "),
         }),
      )
      return false
   }

   if (
      (flag.isAttack || flag.isStrike) &&
      flag.usesAmmunition !== false &&
      !hasSpendableAmmo(siege, flag, actionItem)
   )
      return false

   if (flag.isAttack || flag.isStrike)
      await _normalizeSiegeOffensiveEffectRules(siege)

   if (
      (flag.isAttack || flag.isStrike) &&
      flag.usesAmmunition !== false &&
      !skillGatesAbility &&
      !isStrike
   ) {
      if (!(await deductAmmo(siege, flag, actionItem))) return
   }

   const applyEffects = () => applyActionEffects(siege, actionItem, flag)
   let usedSkillRoll = false
   let skillRollOutcome = null

   if (btnType === "skill") {
      usedSkillRoll = true
      const resolvedSkillIdx =
         skillIdx ?? (await _promptSkillIndex(crewman, flag, state.autoDC))
      if (resolvedSkillIdx === null) return false
      const skillResult = await handleSkillRoll(
         eventObj,
         resolvedSkillIdx,
         actionItem,
         crewman,
         siege,
         flag,
         {
            autoDC: state.autoDC,
            customOptions,
            shorthandedPenalty: state.shorthandedPenalty,
            applyEffects:
               isLoading || skillGatesAbility ? async () => {} : applyEffects,
            app: appShim,
            deferSuccessConsequences: isLoading || skillGatesAbility,
            onOutcome: (outcome) => {
               skillRollOutcome = outcome
            },
         },
      )
      if (!skillResult) return
      if (skillGatesAbility) {
         if (flag.usesAmmunition !== false) {
            if (!(await deductAmmo(siege, flag, actionItem))) return
         }
         btnType = "ability-attack"
      }
   }

   if (isLoading) {
      const preselectedAction = preselectedLoadStrikeId
         ? siege.items.get(preselectedLoadStrikeId)
         : null
      const success = preselectedAction
         ? await _manageWeaponAmmunitionFromActions(
              siege,
              crewman,
              preselectedAction,
           )
         : await _manageAmmunitionFromLoadAction(siege, crewman)
      if (!success) return

      await ChatMessage.create({
         speaker: ChatMessage.getSpeaker({ actor: crewman }),
         content: tKey("Chat.PerformedAction", {
            crewman: crewman.name,
            action: actionItem.name,
            siege: siege.name,
         }),
      })
      if (!usedSkillRoll)
         await applyConsequences({
            actionItem,
            flag,
            outcome: "no-roll",
            crewman,
            siege,
         })
      else
         await applyConsequences({
            actionItem,
            flag,
            outcome: skillRollOutcome || "success",
            crewman,
            siege,
         })

SiegeSFXManager.play(siege, `action-${actionItem.id}`)

appShim.render?.({ force: false })
      return true
   }

   if (btnType === "none") {
      await ChatMessage.create({
         speaker: ChatMessage.getSpeaker({ actor: crewman }),
         content: tKey("Chat.PerformedAction", {
            crewman: crewman.name,
            action: actionItem.name,
            siege: siege.name,
         }),
      })
      await applyEffects()
      await applyConsequences({
         actionItem,
         flag,
         outcome: "no-roll",
         crewman,
         siege,
      })
      SiegeSFXManager.play(siege, `action-${actionItem.id}`)

      appShim.render?.({ force: false })
      return true
   }

   if (btnType === "ability-attack") {
      await handleAbilityAttack(
         actionItem,
         siege,
         flag,
         body,
         applyEffects,
         crewman,
      )
      await applyConsequences({
         actionItem,
         flag,
         outcome: usedSkillRoll ? skillRollOutcome || "success" : "no-roll",
         crewman,
         siege,
      })

      appShim.render?.({ force: false })
      return true
   }

   if (isStrike) {
      const strikeResult = await handleStrike(eventObj, actionItem, siege, crewman, flag, {
         customOptions,
         rollContext,
         shorthandedPenalty: state.shorthandedPenalty,
         distance,
         isPortable: state.isPortable,
         detailsBody: body,
         applyEffects,
         app: appShim,
      })
      return !!strikeResult
   }

appShim.render?.({ force: false })
   return true
}

export async function runLoadActionForStrike(siege, crewman, strikeAction, event = null) {
   if (!siege || !crewman || !strikeAction) return false
   const position = _positionForCrewman(crewman, siege)
   const state = _buildDialogState(crewman, siege, position)
   const loadAction = state.actions.find(
      (item) =>
         item.name === tKey("ActionTemplates.Load.Name") ||
         item.name === "Loading",
   )
   if (!loadAction) {
      ui.notifications.warn(tKey("Notifications.NoAvailableActions"))
      return false
   }
   return executeActionItem({
      event,
      crewman,
      siege,
      actionItem: loadAction,
      preselectedLoadStrikeId: strikeAction.id,
      ctx: state.ctx,
   })
}

function _positionForCrewman(crewman, siege) {
   const effect = crewman?.itemTypes?.effect?.find(
      (e) =>
         e.getFlag(MODULE_ID, "siegeId") === siege?.id &&
         e.getFlag(MODULE_ID, "position"),
   )
   return effect?.getFlag(MODULE_ID, "position") || null
}

function _defaultButtonType(actionItem, flag, isLoading) {
   if (flag.isStrike) return "strike"
   if (flag.isAttack && flag.skills?.length > 0) return "skill"
   if (flag.isAttack) return "ability-attack"
   if (flag.skills?.length > 0) return "skill"
   if (isLoading) return "none"
   return "none"
}

async function _normalizeSiegeOffensiveEffectRules(siege) {
   const updates = siegeOffensiveEffectRuleUpdates(siege)
   if (updates.length === 0) return
   await SiegeSocketManager.modifySiegeItem(siege.uuid, "update", updates, {
      siegeEffectRuleNormalize: true,
   })
}

function _isRepairAction(actionItem) {
   return (
      actionItem?.name === tKey("ActionTemplates.Repair.Name") ||
      actionItem?.name === tKey("ActionMacro.Repair") ||
      actionItem?.name === "Repair"
   )
}

async function _promptSkillIndex(crewman, flag, autoDC) {
   const skills = flag.skills || []
   if (skills.length === 0) return null
   if (skills.length === 1) return 0

   const options = skills
      .map((s, idx) => {
         const label = formatProficiency(s)
         return `<option value="${idx}">${escapeHTML(label)} (DC ${resolveActionDC(
            crewman,
            s.dc,
            autoDC,
         )})</option>`
      })
      .join("")
   const content = await renderHbs(tplPath("macros/skill-choice-dialog.hbs"), {
      label: tKey("ActionMacro.SkillChoiceLabel"),
      options,
   })

   const choice = await foundry.applications.api.DialogV2.wait({
      classes: ["siege-v2-dialog"],
      window: { title: tKey("ActionMacro.SkillChoiceTitle") },
      content,
      buttons: [
         {
            action: "roll",
            label: tKey("ActionMacro.RollSkill"),
            icon: "fa-solid fa-dice-d20",
            callback: () =>
               parseInt(document.getElementById("siege-skill-choice")?.value),
         },
      ],
   }).catch(() => null)
   return Number.isInteger(choice) ? choice : null
}
