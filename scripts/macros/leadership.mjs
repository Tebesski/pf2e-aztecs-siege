import { MODULE_ID } from "../constants.mjs"
import {
   tKey,
   isSiege,
   isSiegeLifted,
   findLeaderEffect,
   buildCrewLeaderEffect,
} from "../utils.mjs"
import { SiegeCrewManager } from "../managers/crew.mjs"
import { SiegeSocketManager } from "../managers/sockets.mjs"
import { collectLifters } from "../managers/portable-helpers.mjs"

export async function takeLeadershipMacro(crewman, siege) {
   if (!crewman || !siege || !isSiege(siege)) return
   if (!(siege.system.traits?.value || []).includes("portable"))
      return ui.notifications.warn(tKey("Notifications.DelegateOnlyPortable"))
   if (!isSiegeLifted(siege))
      return ui.notifications.warn(
         tKey("Notifications.LeadershipNotLifted", { siege: siege.name }),
      )
   if (findLeaderEffect(siege))
      return ui.notifications.warn(
         tKey("Notifications.LeadershipAlreadyHasLeader", {
            siege: siege.name,
         }),
      )

   await SiegeSocketManager.modifySiegeItem(crewman.uuid, "create", [
      buildCrewLeaderEffect(siege.id),
   ])

   ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: crewman }),
      content: tKey("Leadership.TakenChat", {
         crewman: crewman.name,
         siege: siege.name,
      }),
   })

   await SiegeCrewManager.updateSiegeSpeed(siege)
}

export async function delegateLeadershipMacro(crewman, siege) {
   if (!crewman || !siege || !isSiege(siege)) return

   const leaderEffect = findLeaderEffect(siege)
   if (!leaderEffect || leaderEffect.parent?.id !== crewman.id)
      return ui.notifications.warn(
         tKey("Notifications.LeadershipNotLeader", { siege: siege.name }),
      )

   const candidates = collectLifters(siege, {
      excludeActorId: crewman.id,
   }).filter((l) => l.currentBulk > 0)
   if (candidates.length === 0)
      return ui.notifications.warn(tKey("Leadership.NoTargets"))

   const options = candidates
      .map(
         (c) =>
            `<option value="${c.actor.id}">${tKey("Leadership.TargetOption", {
               name: c.actor.name,
               bulk: c.currentBulk,
            })}</option>`,
      )
      .join("")

   const content = `
      <div class="form-group">
         <label>${tKey("Leadership.DelegateTo")}</label>
         <select id="leadership-target">${options}</select>
      </div>`

   const choice = await foundry.applications.api.DialogV2.wait({
      classes: ["siege-v2-dialog"],
      window: { title: tKey("Leadership.DelegateTitle", { name: siege.name }) },
      position: { width: 420 },
      content,
      buttons: [
         {
            action: "delegate",
            label: tKey("Leadership.DelegateButton"),
            icon: "fa-solid fa-crown",
            callback: () => ({
               targetId:
                  document.getElementById("leadership-target")?.value || null,
            }),
         },
      ],
   })

   if (!choice || !choice.targetId) return
   const target = candidates.find((c) => c.actor.id === choice.targetId)
   if (!target)
      return ui.notifications.warn(tKey("Notifications.TargetNoLongerValid"))

   const existingLeaders = []
   for (const lifter of collectLifters(siege)) {
      const effect = lifter.actor.itemTypes.effect.find(
         (e) =>
            e.getFlag(MODULE_ID, "isCrewLeader") &&
            e.getFlag(MODULE_ID, "siegeId") === siege.id,
      )
      if (effect) existingLeaders.push({ actor: lifter.actor, effect })
   }
   for (const { actor, effect } of existingLeaders) {
      await SiegeSocketManager.modifySiegeItem(
         actor.uuid,
         "delete",
         [effect.id],
         { siegeLeadershipDelegation: true },
      )
   }
   await SiegeSocketManager.modifySiegeItem(target.actor.uuid, "create", [
      buildCrewLeaderEffect(siege.id),
   ])

   ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: crewman }),
      content: tKey("Leadership.DelegatedChat", {
         crewman: crewman.name,
         siege: siege.name,
         target: target.actor.name,
      }),
   })

   await SiegeCrewManager.updateSiegeSpeed(siege)
}
