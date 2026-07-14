import { MODULE_ID } from "../../constants.mjs"
import { tKey } from "../../utils.mjs"
import { SiegeSocketManager } from "../sockets.mjs"
import { REPAIR_SHIELDS_SOURCE_KEY } from "./constants.mjs"
import { staticMethods } from "./helpers.mjs"

class ShieldChatMixin {


   static async syncGeneratedLinks(vehicle, shieldItems, actionItems) {
      const states = foundry.utils.deepClone(this.shieldStates(vehicle))
      let changed = false

      for (const [sourceKey, item] of shieldItems) {
         if (!states[sourceKey]) continue
         if (states[sourceKey].shieldItemId !== item.id) {
            states[sourceKey].shieldItemId = item.id
            changed = true
         }
      }
      for (const [sourceKey, item] of actionItems) {
         if (!states[sourceKey]) continue
         if (states[sourceKey].actionItemId !== item.id) {
            states[sourceKey].actionItemId = item.id
            changed = true
         }
      }

      if (changed) await this.setShieldStates(vehicle, states)
   }



   static async syncShieldItemHp(vehicle, item, changes) {
      const sourceKey = item.getFlag(MODULE_ID, "moduleGenerated")?.sourceKey
      if (!sourceKey || item.getFlag(MODULE_ID, "moduleGenerated")?.kind !== "shield")
         return

      const hpValue = changes?.system?.hp?.value
      if (hpValue === undefined) return

      const states = foundry.utils.deepClone(this.shieldStates(vehicle))
      const state = states[sourceKey]
      if (!state) return

      state.currentHp = Math.min(state.maxHp, Math.max(0, Number(hpValue) || 0))
      state.broken = this.isBroken(state.currentHp, state.maxHp)
      states[sourceKey] = state
      await this.setShieldStates(vehicle, states)
   }



   static _onPreDeleteItem(item, options = {}, _userId) {
      const flag = item.getFlag?.(MODULE_ID, "moduleGenerated")
      if (!flag) return
      if (options.siegeModuleSync) return
      if (flag.kind === "shield") return
      if (flag.kind === "action" && flag.sourceKey === REPAIR_SHIELDS_SOURCE_KEY)
         return
   }



   static async _onDeleteItem(item, options = {}, _userId) {
      if (options.siegeShieldSync || !game.user.isGM) return

      const generated = item.getFlag?.(MODULE_ID, "moduleGenerated")
      const siegeAction = item.getFlag?.(MODULE_ID, "siegeAction")
      if (
         generated?.kind === "action" &&
         siegeAction?.isShieldActivate &&
         generated.sourceKey &&
         !options.siegeModuleSync
      ) {
         const vehicle = item.parent
         const deleted =
            foundry.utils.deepClone(
               vehicle?.getFlag?.(MODULE_ID, "deletedGeneratedShieldActions") || {},
            ) || {}
         deleted[generated.sourceKey] = true
         await vehicle?.setFlag?.(MODULE_ID, "deletedGeneratedShieldActions", deleted)
      }

      const activator = item.getFlag?.(MODULE_ID, "shieldActivator")
      if (activator?.vehicleUuid && activator?.sourceKey) {
         const vehicle = await fromUuid(activator.vehicleUuid)
         if (!vehicle) return
         const toDelete = this.activeShieldEffects(vehicle)
            .filter((effect) => {
               const data = effect.getFlag(MODULE_ID, "shieldActivated") || {}
               return (
                  data.sourceKey === activator.sourceKey &&
                  (!data.activatorActorUuid ||
                     data.activatorActorUuid === item.parent?.uuid)
               )
            })
            .map((effect) => effect.id)
         if (toDelete.length)
            await SiegeSocketManager.modifySiegeItem(
               vehicle.uuid,
               "delete",
               toDelete,
               { siegeShieldSync: true },
            )
         return
      }

      const shield = item.getFlag?.(MODULE_ID, "shieldActivated")
      if (shield?.activatorActorUuid && shield?.sourceKey) {
         const actor = await fromUuid(shield.activatorActorUuid)
         if (!actor) return
         const toDelete = actor.itemTypes.effect
            .filter((effect) => {
               const data = effect.getFlag(MODULE_ID, "shieldActivator") || {}
               return (
                  data.vehicleUuid === item.parent?.uuid &&
                  data.sourceKey === shield.sourceKey
               )
            })
            .map((effect) => effect.id)
         if (toDelete.length)
            await actor.deleteEmbeddedDocuments("Item", toDelete, {
               siegeShieldSync: true,
            })
      }
   }



   static _onUpdateCombat(combat, update) {
      if (update.turn === undefined || !combat?.combatant) return

      const currentKey = `${combat.round}-${combat.turn}`
      const activeCombatant = combat.combatant
      const vehicles = game.actors.filter(
         (actor) => actor.type === "vehicle" && this.hasShieldModules(actor),
      )

      for (const vehicle of vehicles) {
         const toDelete = []
         for (const effect of this.activeShieldEffects(vehicle)) {
            const data = effect.getFlag(MODULE_ID, "shieldActivated") || {}
            if (!data.activatorActorId || !data.activationKey) continue

            const activator = game.actors.get(data.activatorActorId)
            const token = activator?.getActiveTokens?.()[0]
            const activatorCombatant = token
               ? combat.combatants.find((c) => c.tokenId === token.id)
               : null
            if (!activatorCombatant || activatorCombatant.id !== activeCombatant.id)
               continue
            if (data.activationKey !== currentKey) toDelete.push(effect.id)
         }
         if (toDelete.length)
            vehicle.deleteEmbeddedDocuments("Item", toDelete, {
               siegeModuleSync: true,
            })
      }
   }



   static _onRenderChatMessageHTML(message, html) {
      html.addEventListener(
         "click",
         (event) => {
            const blockButton = event.target.closest(
               '[data-action="shieldBlock"], [data-action="target-shieldBlock"]',
            )
            if (blockButton && html.contains(blockButton)) {
               this._onShieldBlockClick(event, blockButton)
               return
            }

            const damageButton = event.target.closest(
               '[data-action="applyDamage"], [data-action="target-applyDamage"]',
            )
            if (damageButton && html.contains(damageButton))
               this._onDamageApplyClick(event, message, damageButton, html)
         },
         { capture: true },
      )
   }



   static async _onShieldBlockClick(event, button) {
      const targetUuid = this._targetUuidForButton(button)
      const actor = this._vehicleForButton(button, targetUuid)
      if (!actor || actor.type !== "vehicle") return
      if (!this.hasShieldModules(actor)) return

      event.preventDefault()
      event.stopImmediatePropagation?.()
      event.stopPropagation()

      if (this._pendingBlockForButton(button, targetUuid)) {
         this._clearPendingBlock(actor, targetUuid)
         button.classList.remove("shield-activated")
         button.removeAttribute("data-shield-id")
         return
      }

      const options = this._activeShieldOptions(actor)
      if (!options.length) {
         ui.notifications.warn(tKey("Shield.NotRaised"))
         return
      }

      const picked =
         options.length === 1
            ? options[0]
            : await this._promptShieldChoice(options)
      if (!picked) return

      this._setPendingBlock(actor, picked, targetUuid)
      await this._equipShieldItem(actor, actor.items.get(picked.shieldItemId))
      button.dataset.shieldId = picked.shieldItemId
      button.classList.add("shield-activated")
   }



   static async _onDamageApplyClick(event, message, button, html) {
      const targetUuid = this._targetUuidForButton(button)
      const pending = this._pendingBlockForButton(button, targetUuid)
      if (!pending) return

      event.preventDefault()
      event.stopImmediatePropagation?.()
      event.stopPropagation()

      const actor = await this._vehicleFromUuid(pending.vehicleUuid)
      if (!actor || actor.type !== "vehicle") {
         this._clearPendingBlock(null, targetUuid, pending)
         return
      }

      const damage = this._damageAmountFromButton(message, button)
      if (damage == null) {
         ui.notifications.warn(tKey("Shield.NoDamageRoll"))
         this._clearPendingBlock(actor, targetUuid, pending)
         this._clearShieldButtons(html, actor)
         return
      }

      await this.applyShieldBlockDamage(
         actor,
         pending,
         damage,
         game.user.id,
      )
      button.classList.add("applied")
      button.closest(".damage-application")?.classList.add("applied")
      this._clearPendingBlock(actor, targetUuid, pending)
      this._clearShieldButtons(html, actor)
   }



   static _targetUuidForButton(button) {
      const rowUuid = button.closest("[data-target-uuid]")?.dataset?.targetUuid
      if (rowUuid) return rowUuid
      const targets = canvas?.tokens?.controlled || []
      return targets.length === 1 ? targets[0].document.uuid : ""
   }



   static _vehicleForButton(button, targetUuid) {
      if (targetUuid) return this._vehicleFromUuidSync(targetUuid)
      const targets = canvas?.tokens?.controlled || []
      return targets.length === 1 ? targets[0].actor : null
   }



   static _vehicleFromUuidSync(uuid) {
      if (!uuid) return null
      let doc = null
      try {
         doc = globalThis.fromUuidSync?.(uuid)
      } catch {
         return null
      }
      return doc?.actor ?? doc?.object?.actor ?? doc ?? null
   }



   static async _vehicleFromUuid(uuid) {
      const doc =
         this._vehicleFromUuidSync(uuid) ||
         (await fromUuid(uuid).catch(() => null))
      return doc?.actor ?? doc?.object?.actor ?? doc ?? null
   }



   static _pendingKeys(vehicle, targetUuid = "") {
      const keys = []
      if (targetUuid) keys.push(targetUuid)
      if (vehicle?.uuid) keys.push(vehicle.uuid)
      else if (vehicle?.id) keys.push(vehicle.id)
      return keys
   }



   static _setPendingBlock(vehicle, block, targetUuid = "") {
      const entry = {
         vehicleUuid: vehicle.uuid,
         targetUuid,
         sourceKey: block.sourceKey,
         shieldItemId: block.shieldItemId,
      }
      for (const key of this._pendingKeys(vehicle, targetUuid))
         this._pendingBlockShieldIds.set(key, entry)
   }



   static _pendingBlockForButton(button, targetUuid = "") {
      if (targetUuid && this._pendingBlockShieldIds.has(targetUuid))
         return this._pendingBlockShieldIds.get(targetUuid)
      const actor = this._vehicleForButton(button, targetUuid)
      for (const key of this._pendingKeys(actor, "")) {
         const pending = this._pendingBlockShieldIds.get(key)
         if (pending) return pending
      }
      return null
   }



   static _clearPendingBlock(vehicle, targetUuid = "", pending = null) {
      for (const key of this._pendingKeys(vehicle, targetUuid))
         this._pendingBlockShieldIds.delete(key)
      if (pending?.vehicleUuid) {
         for (const [key, entry] of this._pendingBlockShieldIds.entries()) {
            if (entry.vehicleUuid === pending.vehicleUuid)
               this._pendingBlockShieldIds.delete(key)
         }
      }
   }



   static _clearShieldButtons(html, vehicle) {
      html
         .querySelectorAll(".dice-total-shield-btn.shield-activated")
         .forEach((button) => {
            const targetUuid = this._targetUuidForButton(button)
            if (targetUuid) {
               const target = this._vehicleFromUuidSync(targetUuid)
               if (
                  target?.uuid !== vehicle?.uuid &&
                  target?.id !== vehicle?.id
               )
                  return
            }
            button.classList.remove("shield-activated")
            button.removeAttribute("data-shield-id")
         })
      if (CONFIG?.PF2E) CONFIG.PF2E.chatDamageButtonShieldToggle = false
   }



   static _damageAmountFromButton(message, button) {
      const multiplier = Number(button.dataset.multiplier ?? 1)
      if (!Number.isFinite(multiplier) || multiplier <= 0) return null

      for (const index of this._rollIndexCandidates(button)) {
         const roll = message.rolls?.at?.(index)
         if (!roll || !Number.isFinite(Number(roll.total))) continue
         let total = null
         if (typeof roll.alter === "function") {
            try {
               const altered = roll.alter(multiplier, 0)
               total = Number(altered?.total)
            } catch {
               total = null
            }
         }
         if (!Number.isFinite(total)) total = Number(roll.total) * multiplier
         return Math.max(0, Math.floor(total))
      }
      return null
   }



   static _rollIndexCandidates(button) {
      const candidates = []
      const add = (value) => {
         const number = Number(value)
         if (Number.isInteger(number) && number >= 0 && !candidates.includes(number))
            candidates.push(number)
      }
      const section = button.closest(".damage-application")
      add(section?.dataset?.targetRollIndex)
      add(section?.dataset?.rollIndex)
      add(button.closest("[data-target-roll-index]")?.dataset?.targetRollIndex)
      add(button.closest("[data-roll-index]")?.dataset?.rollIndex)
      add(0)
      return candidates
   }



   static async _promptShieldChoice(options) {
      if (options.length === 0) return null
      if (options.length === 1) return options[0]

      const escape = (s) =>
         foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "")
      const selectOptions = options
         .map(
            (opt) =>
               `<option value="${escape(opt.shieldItemId)}">${escape(opt.label)}</option>`,
         )
         .join("")

      const pickedId = await foundry.applications.api.DialogV2.wait({
         classes: ["siege-v2-dialog"],
         window: { title: tKey("Shield.SelectShield") },
         content: `<div class="form-group siege-form-group"><label>${tKey("Shield.SelectShield")}</label><select id="siege-shield-pick">${selectOptions}</select></div>`,
         buttons: [
            {
               action: "ok",
               label: tKey("Buttons.Confirm"),
               icon: "fa-solid fa-check",
               callback: () =>
                  document.getElementById("siege-shield-pick")?.value || null,
            },
            {
               action: "cancel",
               label: tKey("Buttons.Cancel"),
               callback: () => null,
            },
         ],
      }).catch(() => null)

      if (!pickedId) return null
      return options.find((opt) => opt.shieldItemId === pickedId) || null
   }
}

export const shieldChatMethods = staticMethods(ShieldChatMixin)
