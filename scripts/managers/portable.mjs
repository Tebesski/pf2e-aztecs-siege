import { MODULE_ID, DEFAULT_LIFTED_IMG } from "../constants.mjs"
import { tKey, validImg } from "../utils.mjs"

export class SiegePortableManager {
   static initHooks() {
      Hooks.on("preDeleteItem", (item, options) =>
         this.onPreDeleteItem(item, options),
      )
      Hooks.on("preUpdateItem", (item, changes, options) =>
         this.onPreUpdateItem(item, changes, options),
      )
      Hooks.on("updateItem", (item, changes, options, userId) =>
         this.onUpdateItem(item, changes, options, userId),
      )
      Hooks.on("deleteItem", (item, options, userId) =>
         this.onDeleteItem(item, options, userId),
      )
   }

   static onPreDeleteItem(item, options) {
      if (options.systemDeletion || options.siegeDropCascade) return
      if (
         item.name === tKey("Markers.Dropped") &&
         item.getFlag(MODULE_ID, "isPortableMarker")
      ) {
         ui.notifications.warn(tKey("Notifications.DroppedCannotRemove"))
         return false
      }
   }

   static onPreUpdateItem(item, changes, options) {
      if (options.siegeDropCascade) return

      const isLiftingEffect =
         item.type === "effect" && item.getFlag(MODULE_ID, "isLiftingEffect")
      const isLiftedItem = item.getFlag(MODULE_ID, "isLiftedItem")
      if (!isLiftingEffect && !isLiftedItem) return

      const newBulkRaw = isLiftingEffect
         ? foundry.utils.getProperty(changes, "system.badge.value")
         : foundry.utils.getProperty(changes, "system.bulk.value")
      if (newBulkRaw === undefined) return

      const oldBulk = isLiftingEffect
         ? item.system.badge?.value || 0
         : item.system.bulk?.value || 0
      const newBulk = Number(newBulkRaw) || 0

      // Always assign the old value so onUpdateItem can read it
      if (isLiftingEffect) options.siegeOldBadge = oldBulk
      else options.siegeOldBulk = oldBulk

      // Stop here if we are reducing bulk (no capacity checks needed)
      if (newBulk <= oldBulk) return

      const actor = item.parent
      const siegeId = item.getFlag(MODULE_ID, "siegeId")
      if (!actor || !siegeId) return
      const siege = game.actors.get(siegeId)
      if (!siege) return

      const capData = this._getLifterCapacity(actor, oldBulk)
      let cap = capData.capacity

      const totalBulk = parseInt(siege.getFlag(MODULE_ID, "bulk")) || 0
      const others = this._collectLifters(siege, { excludeActorId: actor.id })
      const otherSum = others.reduce((s, o) => s + o.currentBulk, 0)
      const siegeRoom = Math.max(0, totalBulk - otherSum)
      cap = Math.min(cap, siegeRoom)

      if (newBulk > cap) {
         const clamped = Math.max(oldBulk, cap)
         if (isLiftingEffect)
            foundry.utils.setProperty(changes, "system.badge.value", clamped)
         else foundry.utils.setProperty(changes, "system.bulk.value", clamped)
         ui.notifications.warn(
            tKey("Notifications.LiftCappedByCapacity", { max: cap }),
         )
      }
   }

   static async onUpdateItem(item, changes, options, userId) {
      if (game.user.id !== userId || options.siegeDropCascade) return

      const siegeId = item.getFlag(MODULE_ID, "siegeId")
      if (!siegeId) return
      const siege = game.actors.get(siegeId)
      if (!siege) return
      const actor = item.parent
      if (!actor) return

      const isLiftingEffect =
         item.type === "effect" && item.getFlag(MODULE_ID, "isLiftingEffect")
      const isLiftedItem = item.getFlag(MODULE_ID, "isLiftedItem")
      if (!isLiftingEffect && !isLiftedItem) return

      const newBulk = isLiftingEffect
         ? item.system.badge?.value || 0
         : item.system.bulk?.value || 0
      const oldBulk = isLiftingEffect
         ? (options.siegeOldBadge ?? newBulk)
         : (options.siegeOldBulk ?? newBulk)
      if (newBulk === oldBulk) return

      await this._syncPair(
         actor,
         siege,
         isLiftingEffect ? "effect" : "item",
         newBulk,
      )
      await this.syncPortableState(siege)
   }

   static async onDeleteItem(item, options, userId) {
      if (game.user.id !== userId || options.siegeDropCascade) return

      const isDroppedMarker =
         item.name === tKey("Markers.Dropped") &&
         item.getFlag(MODULE_ID, "isPortableMarker")
      const isLiftedMarker =
         item.name === tKey("Markers.Lifted") &&
         item.getFlag(MODULE_ID, "isPortableMarker")
      if (isDroppedMarker || isLiftedMarker) {
         if (options.systemDeletion) return
         const siege = item.parent
         if (siege) await this.syncPortableState(siege)
         return
      }

      const siegeId = item.getFlag(MODULE_ID, "siegeId")
      if (!siegeId) return
      const actor = item.parent
      const siege = game.actors.get(siegeId)
      if (!actor || !siege) return

      const isPositionEffect =
         item.type === "effect" && item.getFlag(MODULE_ID, "position")
      const isLiftingEffect =
         item.type === "effect" && item.getFlag(MODULE_ID, "isLiftingEffect")
      const isLiftedItem = item.getFlag(MODULE_ID, "isLiftedItem")
      if (!isPositionEffect && !isLiftingEffect && !isLiftedItem) return

      const toDelete = []
      for (const i of actor.items) {
         if (i.id === item.id) continue
         if (i.getFlag(MODULE_ID, "siegeId") !== siegeId) continue
         if (isPositionEffect) {
            if (
               i.getFlag(MODULE_ID, "isLiftingEffect") ||
               i.getFlag(MODULE_ID, "isLiftedItem")
            ) {
               toDelete.push(i.id)
            }
         } else if (isLiftingEffect && i.getFlag(MODULE_ID, "isLiftedItem")) {
            toDelete.push(i.id)
         } else if (
            isLiftedItem &&
            i.type === "effect" &&
            i.getFlag(MODULE_ID, "isLiftingEffect")
         ) {
            toDelete.push(i.id)
         }
      }
      if (toDelete.length > 0) {
         await actor.deleteEmbeddedDocuments("Item", toDelete, {
            siegeDropCascade: true,
         })
      }

      await this.syncPortableState(siege, item.id)
   }

   static async _syncPair(actor, siege, source, newBulk) {
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

      if (
         source === "effect" &&
         liftedItem &&
         (liftedItem.system?.bulk?.value || 0) !== newBulk
      ) {
         await liftedItem.update(
            { "system.bulk.value": newBulk },
            { siegeDropCascade: true },
         )
      } else if (
         source === "item" &&
         liftingEffect &&
         (liftingEffect.system?.badge?.value || 0) !== newBulk
      ) {
         await liftingEffect.update(
            { "system.badge.value": newBulk },
            { siegeDropCascade: true },
         )
      }
   }

   static async _setLifterBulk(lifter, siege, newBulk) {
      const { liftedItem, liftingEffect } = lifter
      if (liftedItem && (liftedItem.system?.bulk?.value || 0) !== newBulk) {
         await liftedItem.update(
            { "system.bulk.value": newBulk },
            { siegeDropCascade: true },
         )
      }
      if (liftingEffect) {
         if ((liftingEffect.system?.badge?.value || 0) !== newBulk) {
            await liftingEffect.update(
               { "system.badge.value": newBulk },
               { siegeDropCascade: true },
            )
         }
      }
   }

   static async _syncPair(actor, siege, source, newBulk) {
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

      if (
         source === "effect" &&
         liftedItem &&
         (liftedItem.system?.bulk?.value || 0) !== newBulk
      ) {
         await liftedItem.update(
            { "system.bulk.value": newBulk },
            { siegeDropCascade: true },
         )
      } else if (
         source === "item" &&
         liftingEffect &&
         (liftingEffect.system?.badge?.value || 0) !== newBulk
      ) {
         await liftingEffect.update(
            { "system.badge.value": newBulk },
            { siegeDropCascade: true },
         )
      }
   }

   static async _refreshLiftingName(actor, siege, newBulk) {
      const liftingEffect = actor.items.find(
         (i) =>
            i.type === "effect" &&
            i.getFlag(MODULE_ID, "isLiftingEffect") &&
            i.getFlag(MODULE_ID, "siegeId") === siege.id,
      )
      if (!liftingEffect) return
      const totalBulk = parseInt(siege.getFlag(MODULE_ID, "bulk")) || 0
      const newName = tKey("Markers.LiftingEffect", {
         bulk: newBulk,
         total: totalBulk,
      })
      if (liftingEffect.name === newName) return
      await liftingEffect.update({ name: newName }, { siegeDropCascade: true })
   }

   static async _redistributeFreed(siege, freedBulk, excludeActorId) {
      if (freedBulk <= 0) return 0
      const others = this._collectLifters(siege, { excludeActorId })
      if (others.length === 0) return freedBulk

      const assignments = new Map(
         others.map((o) => [o.actor.id, o.currentBulk]),
      )
      let remaining = freedBulk
      const guardMax = remaining * others.length + 1
      let guard = guardMax

      while (remaining > 0 && guard-- > 0) {
         let target = null
         let targetCurrent = Infinity
         for (const o of others) {
            const current = assignments.get(o.actor.id)
            if (current >= o.capacity) continue
            if (current < targetCurrent) {
               target = o
               targetCurrent = current
            }
         }
         if (!target) break
         assignments.set(target.actor.id, targetCurrent + 1)
         remaining -= 1
      }

      for (const o of others) {
         const newBulk = assignments.get(o.actor.id)
         if (newBulk === o.currentBulk) continue
         await this._setLifterBulk(o, siege, newBulk)
      }

      return remaining
   }

   static async _setLifterBulk(lifter, siege, newBulk) {
      const { liftedItem, liftingEffect } = lifter
      if (liftedItem && (liftedItem.system?.bulk?.value || 0) !== newBulk) {
         await liftedItem.update(
            { "system.bulk.value": newBulk },
            { siegeDropCascade: true },
         )
      }
      if (liftingEffect) {
         const updates = {}
         if ((liftingEffect.system?.badge?.value || 0) !== newBulk) {
            updates["system.badge.value"] = newBulk
         }
         const totalBulk = parseInt(siege.getFlag(MODULE_ID, "bulk")) || 0
         const newName = tKey("Markers.LiftingEffect", {
            bulk: newBulk,
            total: totalBulk,
         })
         if (liftingEffect.name !== newName) updates.name = newName
         if (Object.keys(updates).length > 0) {
            await liftingEffect.update(updates, { siegeDropCascade: true })
         }
      }
   }

   static async syncPortableState(siege, deletedItemId = null) {
      if (!siege) return
      const traits = siege.system.traits?.value || []
      if (!traits.includes("portable")) {
         await this._clearPortableMarkers(siege)
         return
      }

      const totalBulk = parseInt(siege.getFlag(MODULE_ID, "bulk")) || 0
      let currentlyLifted = 0

      const allActors = new Set([
         ...game.actors,
         ...(canvas?.tokens?.placeables?.map((t) => t.actor).filter(Boolean) ||
            []),
      ])

      for (const actor of allActors) {
         if (!actor) continue
         const effects = actor.items.filter(
            (i) =>
               i.id !== deletedItemId &&
               i.type === "effect" &&
               i.getFlag(MODULE_ID, "isLiftingEffect") &&
               i.getFlag(MODULE_ID, "siegeId") === siege.id,
         )
         for (const e of effects) currentlyLifted += e.system.badge?.value || 0
      }

      const droppedRemaining = Math.max(0, totalBulk - currentlyLifted)
      const droppedName = tKey("Markers.Dropped")
      const liftedName = tKey("Markers.Lifted")
      const existingDropped = siege.itemTypes.effect.find(
         (e) =>
            e.name === droppedName && e.getFlag(MODULE_ID, "isPortableMarker"),
      )
      const existingLifted = siege.itemTypes.effect.find(
         (e) =>
            e.name === liftedName && e.getFlag(MODULE_ID, "isPortableMarker"),
      )

      if (totalBulk === 0 || droppedRemaining === 0) {
         if (existingDropped) {
            await existingDropped.delete({ systemDeletion: true })
         }
         if (!existingLifted) {
            await siege.createEmbeddedDocuments("Item", [
               {
                  name: liftedName,
                  type: "effect",
                  img: "icons/svg/upgrade.svg",
                  system: {
                     level: { value: 1 },
                     description: {
                        value: tKey("Markers.LiftedDesc", { name: siege.name }),
                     },
                     tokenIcon: { show: true },
                  },
                  flags: { [MODULE_ID]: { isPortableMarker: true } },
               },
            ])
         }
      } else {
         if (existingLifted) {
            await existingLifted.delete({ systemDeletion: true })
         }
         if (existingDropped) {
            if (
               (existingDropped.system.badge?.value || 0) !== droppedRemaining
            ) {
               await existingDropped.update({
                  "system.badge.value": droppedRemaining,
               })
            }
         } else {
            await siege.createEmbeddedDocuments("Item", [
               {
                  name: droppedName,
                  type: "effect",
                  img: "icons/svg/downgrade.svg",
                  system: {
                     level: { value: 1 },
                     badge: { type: "counter", value: droppedRemaining },
                     description: {
                        value: tKey("Markers.DroppedDescFull", {
                           name: siege.name,
                        }),
                     },
                     tokenIcon: { show: true },
                  },
                  flags: { [MODULE_ID]: { isPortableMarker: true } },
               },
            ])
         }
      }

      if (siege.sheet?.rendered) siege.sheet.render(false)
   }

   static async _clearPortableMarkers(siege) {
      for (const actor of game.actors) {
         const ids = actor.items
            .filter(
               (i) =>
                  i.getFlag(MODULE_ID, "siegeId") === siege.id &&
                  (i.getFlag(MODULE_ID, "isLiftingEffect") ||
                     i.getFlag(MODULE_ID, "isLiftedItem")),
            )
            .map((i) => i.id)
         if (ids.length > 0) {
            await actor.deleteEmbeddedDocuments("Item", ids, {
               siegeDropCascade: true,
            })
         }
      }
      const markers = siege.itemTypes.effect.filter((e) =>
         e.getFlag(MODULE_ID, "isPortableMarker"),
      )
      if (markers.length > 0) {
         await siege.deleteEmbeddedDocuments(
            "Item",
            markers.map((m) => m.id),
            { systemDeletion: true },
         )
      }
   }

   static _getLifterCapacity(actor, currentLiftedBulk = 0) {
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

   static _collectLifters(siege, { excludeActorId = null } = {}) {
      const lifters = []
      for (const actor of game.actors) {
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
         const capData = this._getLifterCapacity(actor, currentBulk)

         lifters.push({
            actor,
            liftedItem,
            liftingEffect,
            currentBulk,
            capacity: capData.capacity,
         })
      }
      return lifters
   }

   static async rebalanceLifters(siege) {
      await this.syncPortableState(siege)
   }
}
