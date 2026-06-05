import { MODULE_ID } from "../constants.mjs"
import { slugify, splitCSV, ensureSiegeRoll, tKey } from "../utils.mjs"
import { AmmunitionManager } from "./ammunition.mjs"

export class SiegeChatManager {
   static initHooks() {
      Hooks.on("renderChatMessageHTML", (msg, html) =>
         this.onRenderChatMessageHTML(msg, html),
      )
   }

   static onRenderChatMessageHTML(msg, html) {
      const crewmanId = msg.getFlag(MODULE_ID, "crewmanId")
      const strikeLabel = msg.getFlag(MODULE_ID, "strikeLabel")
      const siegeId = msg.getFlag(MODULE_ID, "siegeId")
      const siegeTokenId = msg.getFlag(MODULE_ID, "siegeTokenId")
      const originUuid = msg.flags?.pf2e?.origin?.uuid

      if (!(crewmanId && strikeLabel && siegeId)) return

      const selector =
         "button[data-action='strike-damage'], button[data-action='strike-critical']"
      $(html)
         .find(selector)
         .on("click", (e) =>
            this._handleDamageClick(
               e,
               crewmanId,
               strikeLabel,
               siegeId,
               siegeTokenId,
               originUuid,
               msg,
            ),
         )
   }

   static async _handleDamageClick(
      e,
      crewmanId,
      strikeLabel,
      siegeId,
      siegeTokenId,
      originUuid,
      msg = null,
   ) {
      e.preventDefault()
      e.stopPropagation()

      const crewman = game.actors.get(crewmanId)
      if (!crewman) {
         return ui.notifications.warn(tKey("Notifications.CrewmanNotFound"))
      }

      const siege = game.actors.get(siegeId)
      const strike = crewman.system.actions?.find(
         (a) => a.type === "strike" && a.label === strikeLabel,
      )
      if (!strike) {
         return ui.notifications.warn(tKey("Notifications.StrikeNotFoundRemount"))
      }

      const isCritical =
         $(e.currentTarget).attr("data-action") === "strike-critical"
      const customOptions = ensureSiegeRoll(siege || { name: "siege" })

      const actionItem = siege?.items.find(
         (i) => i.type === "action" && i.name === strikeLabel,
      )
      const storedRollOptions = msg?.getFlag?.(MODULE_ID, "rollOptions")
      const storedTraits = msg?.getFlag?.(MODULE_ID, "traits")
      if (storedRollOptions != null || storedTraits != null) {
         customOptions.push(...splitCSV(storedRollOptions || ""))
         splitCSV(storedTraits || "").forEach((t) =>
            customOptions.push(`trait:${t}`),
         )
      } else if (actionItem) {
         const rawFlag = actionItem.getFlag(MODULE_ID, "siegeAction") || {}
         const ammoPayload =
            rawFlag.usesAmmunition !== false
               ? AmmunitionManager.activeAmmoPayload(siege, actionItem)
               : null
         const flag = ammoPayload
            ? AmmunitionManager.applyAmmoOverridesToFlag(rawFlag, ammoPayload)
            : rawFlag
         customOptions.push(...splitCSV(flag.rollOptions))
         splitCSV(flag.traits).forEach((t) => customOptions.push(`trait:${t}`))
      }

      let rolling = true
      const hookId = Hooks.on("preCreateChatMessage", (damageMsg) => {
         if (!rolling) return
         if (damageMsg.flags?.pf2e?.context?.type !== "damage-roll") return
         const updates = {
            "speaker.alias": siege?.name || tKey("Actor.SiegeWeapon"),
            "speaker.token": siegeTokenId,
         }
         if (originUuid) {
            updates["flags.pf2e.origin.uuid"] = originUuid
            updates["flags.pf2e.origin.type"] = "action"
         }
         damageMsg.updateSource(updates)
      })

      try {
         const opts = { event: e.originalEvent ?? e, options: customOptions }
         if (isCritical) await strike.critical(opts)
         else await strike.damage(opts)
      } finally {
         rolling = false
         Hooks.off("preCreateChatMessage", hookId)
      }
   }
}
