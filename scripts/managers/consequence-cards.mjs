import { MODULE_ID } from "../constants.mjs"
import { tKey } from "../utils.mjs"
import { SiegeCrewManager } from "./crew.mjs"
import { CARD_FLAG } from "./consequence-cards/helpers.mjs"
import { consequenceCardInspectorMethods } from "./consequence-cards/inspector.mjs"
import { consequenceCardRenderMethods } from "./consequence-cards/render.mjs"
import { consequenceCardRollMethods } from "./consequence-cards/rolls.mjs"

export class ConsequenceCardManager {
   static initHooks() {
      Hooks.once("setup", () => this._installContextMenu())
      Hooks.once("ready", () => this._installListeners())
   }

   static async postConsequenceCard({
      mode = "damage",
      formula,
      targets = [],
      actionItem,
      crewman,
   } = {}) {
      const tokenDocs = this._tokenDocsForTargets(targets)
      if (tokenDocs.length < 1) return false
      this._targetTokenDocs(tokenDocs)

      const content = await this._renderCard({
         mode,
         formula,
         tokenDocs,
         actionItem,
      })

      await ChatMessage.create({
         speaker: ChatMessage.getSpeaker({ actor: crewman || targets[0] }),
         content,
         flags: {
            [MODULE_ID]: {
               [CARD_FLAG]: {
                  mode,
                  formula,
                  rollData: null,
                  targetHpRolls: {},
                  targetTokenUuids: tokenDocs.map((doc) => doc.uuid),
                  actionUuid: actionItem?.uuid || null,
               },
            },
         },
      })
      return true
   }

   static async postSavingThrowCard({
      consequence,
      targets = [],
      actionItem,
      crewman,
      siege,
   } = {}) {
      const tokenDocs = this._tokenDocsForTargets(targets)
      if (tokenDocs.length < 1) return false
      this._targetTokenDocs(tokenDocs)
      const dc = this._resolveSaveDC(consequence?.dc, crewman)
      const hpRolls = await this._rollSaveHpConsequences(consequence)
      const basicDamageRoll = await this._rollBasicSaveDamage(consequence)
      const content = await this._renderSaveCard({
         consequence,
         hpRolls,
         basicDamageRoll,
         tokenDocs,
         actionItem,
         dc,
      })
      await ChatMessage.create({
         speaker: ChatMessage.getSpeaker({ actor: crewman || targets[0] }),
         content,
         flags: {
            [MODULE_ID]: {
               [CARD_FLAG]: {
                  mode: "save",
                  consequence: foundry.utils.deepClone(consequence),
                  hpRolls,
                  basicDamageRoll,
                  targetHpRolls: {},
                  saveDC: dc,
                  targetTokenUuids: tokenDocs.map((doc) => doc.uuid),
                  actionUuid: actionItem?.uuid || null,
                  siegeUuid: siege?.uuid || null,
               },
            },
         },
      })
      return true
   }

   static async gmApplyCardDamage(payload = {}) {
      return this._applyCardDamage(payload)
   }

   static async gmApplyCardHealing(payload = {}) {
      return this._applyCardHealing(payload)
   }

   static async gmPersistCard(payload = {}) {
      const message = payload?.messageId
         ? game.messages.get(payload.messageId)
         : null
      if (!message) return false
      const update = {}
      if (typeof payload.content === "string") update.content = payload.content
      if (payload.cardData)
         update[`flags.${MODULE_ID}.${CARD_FLAG}`] = payload.cardData

      if (payload.inspectorKey) {
         const inspector = foundry.utils.deepClone(
            message.getFlag(MODULE_ID, "inspector") || {},
         )
         if (payload.inspectorClear) delete inspector[payload.inspectorKey]
         else if (payload.inspectorSource)
            inspector[payload.inspectorKey] =
               typeof payload.inspectorSource === "string"
                  ? payload.inspectorSource
                  : JSON.stringify(payload.inspectorSource)
         update[`flags.${MODULE_ID}.inspector`] = inspector
      }

      if (Object.keys(update).length === 0) return false
      await message.update(update)
      return true
   }

   static _installListeners() {
      if (this._listenersInstalled) return
      this._listenersInstalled = true
      document.addEventListener("click", (event) => {
         const control = event.target.closest?.("[data-siege-consequence-action]")
         if (!control) return
         const card = control.closest(".siege-consequence-card")
         if (!card) return
         event.preventDefault()
         this._handleCardClick(control, card)
      })
      document.addEventListener("contextmenu", (event) => {
         this._inspectorContext = null
         this._rerollContext = null
         const row = event.target.closest?.(
            ".siege-consequence-card .target-row",
         )
         if (!row) return
         const messageId = row.closest("[data-message-id]")?.dataset.messageId
         if (!messageId) return
         this._inspectorContext = {
            messageId,
            key: String(row.dataset.targetUuid || "").replace(/[.\s]+/g, "_"),
         }
         const result = event.target.closest?.(".siege-consequence-card .degree")
         if (!result || result.classList.contains("hidden")) return
         this._rerollContext = {
            messageId,
            targetUuid: row.dataset.targetUuid || null,
         }
      }, true)
   }

   static _installContextMenu() {
      if (this._contextMenuInstalled) return
      const proto = CONFIG?.ui?.chat?.prototype
      const original = proto?._getEntryContextOptions
      if (typeof original !== "function") return
      const manager = this
      this._contextMenuInstalled = true
      proto._getEntryContextOptions = function (...args) {
         const options = original.apply(this, args)
         if (!Array.isArray(options)) return options
         const gateKey =
            (game.release?.generation ?? 13) >= 14 ? "visible" : "condition"
         const inspect = {
            name: "PF2E.ChatRollDetails.Select",
            icon: '<i class="fa-solid fa-magnifying-glass"></i>',
            callback: (li) => manager._openStoredInspector(li),
         }
         inspect[gateKey] = (li) => manager._hasStoredInspector(li)
         const reroll = {
            name: "PF2E.RerollMenu.HeroPoint",
            icon: '<i class="fa-solid fa-hospital-symbol"></i>',
            callback: async (li) => manager._heroPointReroll(li),
         }
         reroll[gateKey] = (li) => manager._canHeroPointReroll(li)
         options.push(inspect, reroll)
         return options
      }
   }

   static async _handleCardClick(control, card) {
      const action = control.dataset.siegeConsequenceAction
      if (action === "expand-roll") {
         const roll = control.closest(".dice-roll")
         roll?.classList.toggle("expanded")
         return
      }
      const row = control.closest("[data-target-uuid]")
      const targetUuid = row?.dataset.targetUuid
      if (!targetUuid) return

      if (action === "save") {
         if (row?.dataset.rolled === "true") return
         await this._rollSavingThrow(control, card, targetUuid, {
            isReroll: false,
         })
         return
      }
      if (action === "reroll-save") {
         const saveControl = row?.querySelector?.(
            "[data-siege-consequence-action='save']",
         )
         if (saveControl)
            await this._rollSavingThrow(saveControl, card, targetUuid, {
               isReroll: true,
            })
         return
      }

      const messageId = card.closest(".message")?.dataset.messageId
      const message = messageId ? game.messages.get(messageId) : null
      const data = message?.getFlag(MODULE_ID, CARD_FLAG)
      if (!data) return

      if (!(await this._canUseTarget(targetUuid))) {
         ui.notifications.warn(tKey("Consequences.CardOwnerOnly"))
         return
      }

      const payload = {
         targetUuid,
         multiplier: Number(control.dataset.multiplier || 1),
      }
      const hpRoll = await this._ensureCardHpRoll({
         data,
         control,
         targetUuid,
         card,
      })
      if (!hpRoll?.rollData) return

      if (action === "heal" || data.mode === "heal" || hpRoll?.mode === "heal") {
         payload.healing = hpRoll?.rollData || data.rollData
         await this._routeCardAction("applyConsequenceCardHealing", payload)
      } else {
         payload.damage = hpRoll?.rollData || data.rollData
         await this._routeCardAction("applyConsequenceCardDamage", payload)
      }

      await this._markApplied(control)
   }

   static async _routeCardAction(handler, payload) {
      if (game.user.isGM) {
         if (handler === "applyConsequenceCardHealing")
            return this._applyCardHealing(payload)
         return this._applyCardDamage(payload)
      }
      if (!globalThis.siegeSocket) {
         ui.notifications.error(tKey("Notifications.SocketlibRequired"))
         return false
      }
      return globalThis.siegeSocket.executeAsGM(handler, payload)
   }

   static async _rollSavingThrow(
      control,
      card,
      targetUuid,
      { isReroll = false, heroPoint = false } = {},
   ) {
      const messageId = card.closest(".message")?.dataset.messageId
      const message = messageId ? game.messages.get(messageId) : null
      const data = message?.getFlag(MODULE_ID, CARD_FLAG)
      const consequence = data?.consequence
      if (!message || !consequence) return false
      if (!(await this._canUseTarget(targetUuid))) {
         ui.notifications.warn(tKey("Consequences.CardOwnerOnly"))
         return false
      }
      const tokenDoc = await fromUuid(targetUuid).catch(() => null)
      const targetActor = tokenDoc?.actor
      const save = consequence.save || "reflex"
      const substitute = SiegeCrewManager.bestVehicleSaveSubstitute(targetActor, save)
      const rollingActor = substitute?.actor || targetActor
      const stat = substitute?.stat || targetActor?.saves?.[save]
      if (!stat?.roll) return false
      if (heroPoint && !this._hasHeroPoint(rollingActor)) return false
      const dc = Number.isFinite(Number(data.saveDC))
         ? Math.floor(Number(data.saveDC))
         : this._resolveSaveDC(consequence.dc, targetActor)
      let inspectorSource = null
      let callbackOutcome = null
      const roll = await stat.roll({
         dc: { value: dc },
         createMessage: false,
         extraRollOptions: consequence.basicSave ? ["damaging-effect"] : [],
         callback: (_roll, outcome, message) => {
            callbackOutcome = outcome
            inspectorSource = this._captureInspectorSource(message)
         },
      })
      if (!roll) return false
      if (heroPoint && !(await this._spendHeroPoint(rollingActor))) return false
      await this._presentCardRoll(roll)
      const outcome = this._outcomeFromRoll(roll, callbackOutcome)
      const d20 = this._d20TotalFromRoll(roll)
      this._renderSaveResult(control, roll, outcome, d20, { isReroll })
      await this._renderTargetHpConsequences({
         data,
         row: control.closest(".target-row"),
         outcome,
         targetUuid,
      })

      const nested = Array.isArray(consequence.consequences)
         ? consequence.consequences.filter(
              (child) => !["deal-damage", "heal"].includes(child?.type),
           )
         : []
      if (nested.length > 0) {
         const { applyConsequences } = await import("../macros/consequences.mjs")
         const siege = data.siegeUuid
            ? await fromUuid(data.siegeUuid).catch(() => null)
            : null
         const actionItem = data.actionUuid
            ? await fromUuid(data.actionUuid).catch(() => null)
            : null
         await applyConsequences({
            actionItem,
            flag: { consequences: nested },
            outcome,
            crewman: targetActor,
            siege,
         })
      }

      await this._persistCardContent(card, {
         inspectorKey: targetUuid.replace(/[.\s]+/g, "_"),
         inspectorSource,
         inspectorClear: isReroll && !inspectorSource,
         cardData: data,
      })
      return true
   }

   static async _applyCardDamage({ targetUuid, damage, multiplier = 1 } = {}) {
      const target = await fromUuid(targetUuid).catch(() => null)
      const actor = target?.actor
      if (!actor || !damage) return false
      const token = target.object || canvas?.tokens?.get(target.id) || null
      let roll = null
      try {
         roll = Roll.fromData(JSON.parse(damage.rollJSON))
      } catch (_err) {
         roll = null
      }
      const scale = Number(multiplier) || 1
      const total = Math.max(0, Math.floor((damage.total || 0) * scale))

      if (roll && actor.applyDamage) {
         this._scaleRollTotal(roll, scale, total)
         await actor.applyDamage({ damage: roll, token })
         return true
      }

      if (actor.applyDamage) {
         await actor.applyDamage({ damage: total, token })
         return true
      }
      return false
   }

   static async _applyCardHealing({ targetUuid, healing, multiplier = 1 } = {}) {
      const target = await fromUuid(targetUuid).catch(() => null)
      const actor = target?.actor
      if (!actor || !healing) return false
      const token = target.object || canvas?.tokens?.get(target.id) || null
      const amount = Math.max(
         0,
         Math.floor(
            (Number(healing.total) || Number(healing.amount) || 0) *
               (Number(multiplier) || 1),
         ),
      )
      if (actor.applyDamage) {
         await actor.applyDamage({ damage: -amount, token })
         return true
      }

      const hpPath = "system.attributes.hp.value"
      const hp = Number(foundry.utils.getProperty(actor, hpPath)) || 0
      const max =
         Number(foundry.utils.getProperty(actor, "system.attributes.hp.max")) || hp
      await actor.update({ [hpPath]: Math.min(max, hp + amount) })
      return true
   }

   static _scaleRollTotal(roll, scale, total) {
      try {
         Object.defineProperty(roll, "_total", {
            value: total,
            configurable: true,
            writable: true,
         })
      } catch (_err) {
         roll._total = total
      }

      for (const instance of roll.instances || []) {
         const instanceTotal = Math.max(
            0,
            Math.floor((Number(instance.total) || 0) * scale),
         )
         try {
            Object.defineProperty(instance, "_total", {
               value: instanceTotal,
               configurable: true,
               writable: true,
            })
         } catch (_err) {
            instance._total = instanceTotal
         }
      }
   }

   static async _canUseTarget(targetUuid) {
      if (game.user.isGM) return true
      const token =
         globalThis.fromUuidSync?.(targetUuid) ||
         await fromUuid(targetUuid).catch(() => null)
      const actor = token?.actor
      return !!actor?.testUserPermission?.(game.user, "OWNER")
   }

   static async _markApplied(control, cardData = null) {
      const row = control.closest(".siege-consequence-target-row")
      const application = control.closest(".siege-consequence-application")
      application?.classList.add("applied")
      if (application) application.style.filter = "blur(1px) opacity(0.55)"
      row?.classList.add("applied")

      const card = control.closest(".siege-consequence-card")
      await this._persistCardContent(card, cardData ? { cardData } : {})
   }

   static async _rollFormula(formula) {
      const RollCls =
         CONFIG?.Dice?.rolls?.find?.((cls) => cls.name === "DamageRoll") ||
         globalThis.DamageRoll ||
         Roll
      let roll = null
      try {
         roll = await new RollCls(formula).evaluate({
            allowInteractive: false,
         })
      } catch (err) {
         if (RollCls === Roll) throw err
         roll = await new Roll(this._stripDamageTags(formula)).evaluate({
            allowInteractive: false,
         })
      }
      return this._rollData(roll, formula)
   }

   static _rollData(roll, formula) {
      const instances = Array.isArray(roll.instances)
         ? roll.instances.map((instance, index) => ({
              formula:
                 instance.head?.expression ||
                 String(instance.formula || formula).replace(/\[[^\]]+\]/g, ""),
              type: instance.type || instance.damageType || "untyped",
              total: Number(instance.total) || 0,
              dice: this._diceResultsForInstance(instance, roll, index),
           }))
         : []

      if (instances.length === 0)
         instances.push({
            formula,
            type: formula.includes("[healing]") ? "healing" : "untyped",
            total: Number(roll.total) || 0,
            dice: this._diceResultsForInstance(null, roll, 0),
         })

      return {
         formula,
         total: Number(roll.total) || 0,
         rollJSON: JSON.stringify(roll.toJSON()),
         tooltipHTML: "",
         instances,
      }
   }
}

Object.assign(
   ConsequenceCardManager,
   consequenceCardRenderMethods,
   consequenceCardRollMethods,
   consequenceCardInspectorMethods,
)
