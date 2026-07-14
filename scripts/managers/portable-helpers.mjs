import { MODULE_ID } from "../constants.mjs"
import { getAllActors } from "../utils.mjs"

export function actorIdsFor(actor) {
   return new Set(
      [
         actor?.id,
         actor?.token?.actorId,
         actor?.token?.baseActor?.id,
         actor?.prototypeToken?.actorId,
      ].filter(Boolean),
   )
}

export function siegeIdsFor(siege) {
   const ids = actorIdsFor(siege)
   for (const token of canvas?.tokens?.placeables ?? []) {
      const actor = token.actor
      if (!actor?.getFlag?.(MODULE_ID, "isSiegeWeapon")) continue
      const tokenIds = new Set([
         token.document?.actorId,
         ...actorIdsFor(actor),
      ].filter(Boolean))
      if ([...tokenIds].some((id) => ids.has(id))) {
         for (const id of tokenIds) ids.add(id)
      }
   }
   return ids
}

export function itemMatchesSiege(item, siegeOrIds) {
   const ids = siegeOrIds instanceof Set ? siegeOrIds : siegeIdsFor(siegeOrIds)
   return ids.has(item?.getFlag?.(MODULE_ID, "siegeId"))
}

export function relatedSiegeActors(siege) {
   const ids = siegeIdsFor(siege)
   const actors = new Map()
   const add = (actor) => {
      if (!actor?.uuid) return
      actors.set(actor.uuid, actor)
   }
   add(siege)
   for (const id of ids) add(game.actors.get(id))
   for (const token of canvas?.tokens?.placeables ?? []) {
      const actor = token.actor
      if (!actor?.getFlag?.(MODULE_ID, "isSiegeWeapon")) continue
      const tokenIds = new Set([
         token.document?.actorId,
         ...actorIdsFor(actor),
      ].filter(Boolean))
      if ([...tokenIds].some((id) => ids.has(id))) add(actor)
   }
   return [...actors.values()]
}

export function portableBulk(siege) {
   const parseBulk = (value) => {
      if (typeof value === "number" && Number.isFinite(value)) return value
      const parsed = parseFloat(String(value ?? "").replace(",", "."))
      return Number.isFinite(parsed) ? parsed : 0
   }

   const direct = parseBulk(siege?.getFlag?.(MODULE_ID, "bulk"))
   if (direct > 0) return direct

   for (const actor of relatedSiegeActors(siege)) {
      const bulk = parseBulk(actor.getFlag?.(MODULE_ID, "bulk"))
      if (bulk > 0) return bulk
   }

   return 0
}

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
   const siegeIds = siegeIdsFor(siege)
   const lifters = []
   for (const actor of getAllActors()) {
      if (excludeActorId && actor.id === excludeActorId) continue
      const liftingEffect = actor.items.find(
         (i) =>
            i.type === "effect" &&
            i.getFlag(MODULE_ID, "isLiftingEffect") &&
            itemMatchesSiege(i, siegeIds),
      )
      const liftedItem = actor.items.find(
         (i) =>
            i.getFlag(MODULE_ID, "isLiftedItem") &&
            itemMatchesSiege(i, siegeIds),
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
