import { MODULE_ID } from "../constants.mjs"
import {
   splitCSV,
   ensureSiegeRoll,
   tKey,
   findMountedSiegeStrike,
   getCrewActors,
} from "../utils.mjs"
import { AmmunitionManager } from "./ammunition.mjs"

export class SiegeChatManager {
   static initHooks() {
      Hooks.on("renderChatMessageHTML", (msg, html) =>
         this.onRenderChatMessageHTML(msg, html),
      )
   }

   static onRenderChatMessageHTML(msg, html) {
      const crewmanId = msg.getFlag(MODULE_ID, "crewmanId")
      const crewmanUuid = msg.getFlag(MODULE_ID, "crewmanUuid")
      const strikeLabel = msg.getFlag(MODULE_ID, "strikeLabel")
      const siegeId = msg.getFlag(MODULE_ID, "siegeId")
      const siegeUuid = msg.getFlag(MODULE_ID, "siegeUuid")
      const siegeTokenId = msg.getFlag(MODULE_ID, "siegeTokenId")
      const originUuid = msg.flags?.pf2e?.origin?.uuid
      const versatileType = msg.getFlag(MODULE_ID, "versatileType")

      if (!(crewmanId && strikeLabel && siegeId)) return

      const selector =
         "button[data-action='strike-damage'], button[data-action='strike-critical']"
      const root = html?.jquery ? html[0] : html
      root?.querySelectorAll?.(selector).forEach((button) =>
         button.addEventListener("click", (e) =>
            this._handleDamageClick(
               e,
               crewmanId,
               crewmanUuid,
               strikeLabel,
               siegeId,
               siegeUuid,
               siegeTokenId,
               originUuid,
               versatileType,
               msg,
            ),
         ),
      )
   }

   static async _handleDamageClick(
      e,
      crewmanId,
      crewmanUuid,
      strikeLabel,
      siegeId,
      siegeUuid,
      siegeTokenId,
      originUuid,
      versatileType = null,
      msg = null,
   ) {
      e.preventDefault()
      e.stopPropagation()

      const crewman =
         (crewmanUuid ? await fromUuid(crewmanUuid).catch(() => null) : null) ||
         game.actors.get(crewmanId)
      if (!crewman) {
         return ui.notifications.warn(tKey("Notifications.CrewmanNotFound"))
      }

      const siege =
         (siegeUuid ? await fromUuid(siegeUuid).catch(() => null) : null) ||
         game.actors.get(siegeId)
      const actionItem = siege?.items.find(
         (i) => i.type === "action" && i.name === strikeLabel,
      )
      const storedRollOptions = msg?.getFlag?.(MODULE_ID, "rollOptions")
      const storedTraits = msg?.getFlag?.(MODULE_ID, "traits")
      const storedResolvedFlag = msg?.getFlag?.(MODULE_ID, "resolvedFlag")
      let flag = null
      if (storedResolvedFlag && typeof storedResolvedFlag === "object") {
         flag = foundry.utils.deepClone(storedResolvedFlag)
         flag.actionId = actionItem?.id || flag.actionId
      } else if (actionItem) {
         const rawFlag = actionItem.getFlag(MODULE_ID, "siegeAction") || {}
         const ammoPayload =
            rawFlag.usesAmmunition !== false
               ? AmmunitionManager.activeAmmoPayload(siege, actionItem)
               : null
         flag = {
            ...(ammoPayload
               ? AmmunitionManager.applyAmmoOverridesToFlag(rawFlag, ammoPayload)
               : rawFlag),
            actionId: actionItem.id,
         }
         if (storedRollOptions != null) flag.rollOptions = storedRollOptions || ""
         if (storedTraits != null) flag.traits = storedTraits || ""
      }

      let strike = null
      let withSiegeOriginToken = null
      if (siege) {
         const actionRolls = await import("../macros/action-roll.mjs")
         const { ensureMountedSiegeRules } = actionRolls
         withSiegeOriginToken = actionRolls.withSiegeOriginToken
         const rebuilt = await ensureMountedSiegeRules({
            crewman,
            siege,
            strikeLabel,
            versatileType,
            flag,
            highestStr: this._highestCrewStrength(siege),
            force: true,
         })
         if (rebuilt && rebuilt !== "missing") strike = rebuilt
      }
      strike ||= findMountedSiegeStrike(crewman, strikeLabel, siege)
      if (!strike) {
         return ui.notifications.warn(tKey("Notifications.StrikeNotFoundRemount"))
      }

      const isCritical = e.currentTarget?.dataset?.action === "strike-critical"
      const customOptions = ensureSiegeRoll(siege || { name: "siege" })
      if (flag) {
         customOptions.push(...splitCSV(flag.rollOptions))
         splitCSV(flag.traits).forEach((t) => customOptions.push(`trait:${t}`))
      } else if (storedRollOptions != null || storedTraits != null) {
         customOptions.push(...splitCSV(storedRollOptions || ""))
         splitCSV(storedTraits || "").forEach((t) =>
            customOptions.push(`trait:${t}`),
         )
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
         const rollDamage = async () => {
            if (isCritical) return strike.critical(opts)
            return strike.damage(opts)
         }
         const strikeActor = strike.item?.actor || crewman
         if (withSiegeOriginToken)
            await withSiegeOriginToken(strikeActor, siege, rollDamage, {
               phase: isCritical ? "critical-damage" : "damage",
               strikeLabel,
               target: game.user.targets.first(),
            })
         else await rollDamage()
      } finally {
         rolling = false
         Hooks.off("preCreateChatMessage", hookId)
      }
   }

   static _highestCrewStrength(siege) {
      const traits = Array.from(siege?.system?.traits?.value || [])
      if (!traits.includes("portable")) return 0
      let highestStr = 0
      for (const actor of getCrewActors(siege)) {
         const strMod = actor.system?.abilities?.str?.mod || 0
         if (strMod > highestStr) highestStr = strMod
      }
      return highestStr
   }
}
