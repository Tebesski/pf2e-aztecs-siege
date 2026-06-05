import { MODULE_ID, DC_BY_LEVEL } from "../constants.mjs"
import {
   clampLevel,
   renderHbs,
   tplPath,
   tKey,
   findCrewmenOf,
   findLeaderEffect,
   isSiegeLifted,
} from "../utils.mjs"
import {
   getActionsForCrew,
   computeCrewStatus,
   ensureSiegeCSS,
   meetsLoadActionsRequired,
   resolveActionDC,
} from "./helpers.mjs"
import { repairMacro } from "./repair.mjs"
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
   applyActionEffects,
   handleSkillRoll,
   handleLoadingFlow,
   handleAbilityAttack,
   handleStrike,
} from "./action-roll.mjs"
import { SiegeSFXManager } from "../managers/sfx.mjs"
import { AmmunitionManager } from "../managers/ammunition.mjs"

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
   const crewLevel = clampLevel(crewman.system.details.level?.value)
   const autoDC =
      siege.getFlag(MODULE_ID, "disableDC") || DC_BY_LEVEL[crewLevel]

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

   const isInside = crewman.itemTypes.effect.some(
      (e) =>
         e.getFlag(MODULE_ID, "isEntered") &&
         e.getFlag(MODULE_ID, "siegeId") === siege.id,
   )

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
   const root = $(app.element)

   root.find("details[data-action-id]").on("toggle", (e) => {
      const id = e.currentTarget.dataset.actionId
      if (!id || !app._openDetails) return
      if (e.currentTarget.open) app._openDetails.add(id)
      else app._openDetails.delete(id)
   })

   root
      .find(".roll-siege-btn")
      .on("click", (e) => _handleRollClick(e, app, ctx))
}

async function _handleRollClick(e, app, ctx) {
   e.preventDefault()
   const btn = $(e.currentTarget)
   const btnType = btn.data("type")
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
      repairMacro(crewman, siege)
      return app.close()
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

   const actionItem = siege.items.get(btn.data("item"))
   if (!actionItem) return
   return executeActionItem({
      event: e,
      app,
      crewman,
      siege,
      actionItem,
      buttonType: btnType,
      skillIdx: btn.data("skillidx"),
      detailsBody: btn.closest(".details-body"),
      ctx,
   })
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

   const position = ctx?.position || _positionForCrewman(crewman, siege)
   const state = ctx || _buildDialogState(crewman, siege, position)
   const appShim =
      app || {
         close() {},
         render() {},
      }

   const rawFlag = actionItem.getFlag(MODULE_ID, "siegeAction") || {}
   const isAmmoAttack =
      (rawFlag.isAttack || rawFlag.isStrike) &&
      rawFlag.usesAmmunition !== false
   const ammoPayload = isAmmoAttack
      ? AmmunitionManager.activeAmmoPayload(siege, actionItem)
      : null
   const flag = isAmmoAttack
      ? AmmunitionManager.applyAmmoOverridesToFlag(rawFlag, ammoPayload)
      : rawFlag
   const body = detailsBody?.length ? detailsBody : $("<div></div>")
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
         console.debug(
            `[siege] action "${actionItem.name}" blocked: vehicle not ignited (needsIgnition=${flag.needsIgnition})`,
         )
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

   
   if ((flag.isAttack || flag.isStrike) && !meetsLoadActionsRequired(siege, flag)) {
      return ui.notifications.warn(
         tKey("Notifications.NeedMoreLoadActions", {
            name: actionItem.name,
            n: parseInt(flag.loadActionsRequired) || 0,
         }),
      )
   }

   if ((flag.isAttack || flag.isStrike) && flag.usesAmmunition !== false) {
      if (!(await deductAmmo(siege, flag, actionItem))) return
   }

   const applyEffects = () => applyActionEffects(siege, actionItem, flag)

   if (btnType === "skill") {
      const resolvedSkillIdx =
         skillIdx ?? (await _promptSkillIndex(crewman, flag, state.autoDC))
      if (resolvedSkillIdx === null) return false
      const skillBtn = $(
         `<button type="button" data-skillidx="${resolvedSkillIdx}"></button>`,
      )
      const skillResult = await handleSkillRoll(
         eventObj,
         skillBtn,
         actionItem,
         crewman,
         siege,
         flag,
         {
            autoDC: state.autoDC,
            customOptions,
            shorthandedPenalty: state.shorthandedPenalty,
            applyEffects,
            app: appShim,
         },
      )
      if (!skillResult) return
   }

   if (isLoading) {
      const success = await handleLoadingFlow(
         actionItem,
         siege,
         crewman,
         flag,
         applyEffects,
         { preselectedActionId: preselectedLoadStrikeId },
      )
      if (!success) return

      await ChatMessage.create({
         speaker: ChatMessage.getSpeaker({ actor: crewman }),
         content: tKey("Chat.PerformedAction", {
            crewman: crewman.name,
            action: actionItem.name,
            siege: siege.name,
         }),
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
      
      appShim.render?.({ force: false })
      return true
   }

   if (isStrike) {
      await handleStrike(eventObj, actionItem, siege, crewman, flag, {
         customOptions,
         rollContext,
         shorthandedPenalty: state.shorthandedPenalty,
         distance,
         isPortable: state.isPortable,
         detailsBody: body,
         applyEffects,
         app: appShim,
      })
      
      return true
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
   if (flag.isAttack) return "ability-attack"
   if (flag.skills?.length > 0) return "skill"
   if (isLoading) return "none"
   return "none"
}

async function _promptSkillIndex(crewman, flag, autoDC) {
   const skills = flag.skills || []
   if (skills.length === 0) return null
   if (skills.length === 1) return 0

   const options = skills
      .map((s, idx) => {
         const label =
            s.name === "lore"
               ? tKey("Skills.LoreSuffix", {
                    name: (s.loreName || "Lore").replace(/-lore$/i, ""),
                 })
               : s.name
         return `<option value="${idx}">${label} (DC ${resolveActionDC(
            crewman,
            s.dc,
            autoDC,
         )})</option>`
      })
      .join("")

   const choice = await foundry.applications.api.DialogV2.wait({
      classes: ["siege-v2-dialog"],
      window: { title: tKey("ActionMacro.SkillChoiceTitle") },
      content: `<div class="form-group siege-form-group"><label>${tKey("ActionMacro.SkillChoiceLabel")}</label><select id="siege-skill-choice">${options}</select></div>`,
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
