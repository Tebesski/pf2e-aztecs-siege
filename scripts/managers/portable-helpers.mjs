import { MODULE_ID } from "../constants.mjs"
import { getAllActors } from "../utils.mjs"

export function getLifterCapacity(actor, currentLiftedBulk = 0) {
   const strMod = actor?.system?.abilities?.str?.mod ?? 0
   const bulkAttr = actor?.system?.attributes?.bulk || {}
   const encumberedAfter = Number(bulkAttr.encumberedAfter) || 5 + strMod
   const maxLimit = Number(bulkAttr.maxLimit ?? bulkAttr.max) || 10 + strMod

   let totalCarried = 0
   const invBulk = actor?.inventory?.bulk?.value ?? bulkAttr.value
   if (typeof invBulk === "number") totalCarried = invBulk
   else if (invBulk !== null && typeof invBulk === "object")
      totalCarried = Number(invBulk.normal) || 0
   else totalCarried = Number(invBulk) || 0

   const lifted = Number(currentLiftedBulk) || 0
   const otherBulk = Math.max(0, totalCarried - lifted)

   return {
      encumberedAfter,
      maxLimit,
      otherBulk,
      capacity: Math.max(0, Math.floor(maxLimit - otherBulk)),
   }
}

export function collectLifters(siege, options = {}) {
   const excludeActorId =
      typeof options === "string" ? options : options?.excludeActorId || null
   const lifters = []
   for (const actor of getAllActors()) {
      if (excludeActorId && actor.id === excludeActorId) continue
      const liftingEffect = actor.items.find(
         (i) =>
            i.type === "effect" &&
            i.getFlag(MODULE_ID, "isLiftingEffect") &&
            i.getFlag(MODULE_ID, "siegeId") === siege.id,
      )
      const liftedItem = actor.items.find(
         (i) =>
            i.getFlag(MODULE_ID, "isLiftedItem") &&
            i.getFlag(MODULE_ID, "siegeId") === siege.id,
      )
      if (!liftedItem && !liftingEffect) continue

      const currentBulk = liftingEffect
         ? liftingEffect.system.badge?.value || 0
         : liftedItem?.system?.bulk?.value || 0
      const capData = getLifterCapacity(actor, currentBulk)

      lifters.push({
         actor,
         liftedItem,
         liftingEffect,
         currentBulk,
         capacity: capData.capacity,
         baseOtherBulk: capData.otherBulk,
         maxLimit: capData.maxLimit,
      })
   }
   return lifters
}
