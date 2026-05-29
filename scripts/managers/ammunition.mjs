import {
   MODULE_ID,
   DEFAULT_AMMO_IMG,
   PHYSICAL_ITEM_TYPES,
} from "../constants.mjs"
import { slugify, isSiege, tKey } from "../utils.mjs"
import { SiegeCrewManager } from "./crew.mjs"

export class AmmunitionManager {
   static initHooks() {
      Hooks.on("preCreateItem", (item, data, options, userId) =>
         this.onPreCreateItem(item, data, options, userId),
      )
      Hooks.on("preUpdateItem", (item, changes, options, userId) =>
         this.onPreUpdateItem(item, changes, options, userId),
      )
      Hooks.on("createItem", (item, options, userId) =>
         this.onItemChange(item, userId),
      )
      Hooks.on("updateItem", (item, changes, options, userId) =>
         this.onItemChange(item, userId),
      )
      Hooks.on("deleteItem", (item, options, userId) =>
         this.onItemDelete(item, userId),
      )
   }

   static slugify(text) {
      return slugify(text)
   }

   static onItemChange(item, userId) {
      if (game.user.id !== userId) return
      if (!item.parent || !isSiege(item.parent)) return

      if (this.isAmmoItem(item)) {
         this.syncLoadedEffects(item.parent)
      } else if (
         item.type === "effect" &&
         item.getFlag(MODULE_ID, "isLoadedMarker")
      ) {
         this.syncAmmoFromEffect(item)
      } else if (item.type === "action") {
         SiegeCrewManager.syncCrewEffects(item.parent)
      }
   }

   static async onItemDelete(item, userId) {
      if (game.user.id !== userId) return
      const actor = item.parent
      if (!actor || !isSiege(actor)) return

      if (this.isAmmoItem(item)) {
         this.syncLoadedEffects(actor)
         return
      }
      if (
         item.type !== "effect" ||
         !item.getFlag(MODULE_ID, "isLoadedMarker")
      )
         return

      const ammoName = item.name.replace(/^Loaded: /, "")
      const slug = slugify(ammoName)
      const ammoItems = actor.items.filter(
         (i) =>
            this.isAmmoItem(i) &&
            (i.system?.slug || slugify(i.name)) === slug,
      )

      if (ammoItems.length > 0) {
         await actor.deleteEmbeddedDocuments(
            "Item",
            ammoItems.map((i) => i.id),
         )
      }
   }

   static onPreCreateItem(item) {
      const actor = item.parent
      if (!actor || !isSiege(actor)) return

      const isPhysicalItem =
         (item.isOfType && item.isOfType("physical")) ||
         PHYSICAL_ITEM_TYPES.includes(item.type)
      if (!isPhysicalItem) return

      if (!this.isAmmoItem(item)) {
         ui.notifications.warn(tKey("Notifications.AmmunitionOnlyStorage"))
         return false
      }

      if (!this.validateItem(item, actor)) {
         ui.notifications.warn(
            tKey("Notifications.InvalidAmmo", { name: item.name }),
         )
         return false
      }

      const itemSlug = item.system?.slug || slugify(item.name)
      const ammoTypes = actor.getFlag(MODULE_ID, "ammunitionTypes") || []
      const allowedType = ammoTypes.find(
         (t) => slugify(t.slug || t.name) === itemSlug,
      )
      if (!allowedType || allowedType.max === "") return

      const maxCap = parseInt(allowedType.max)
      const currentQty = this.getCurrentAmmoCount(actor, itemSlug)
      const incomingQty = item.system?.quantity || 1

      if (currentQty + incomingQty <= maxCap) return

      const allowedIncoming = Math.max(0, maxCap - currentQty)
      if (allowedIncoming <= 0) {
         ui.notifications.warn(
            tKey("Notifications.MaxCapacityReached", { name: item.name }),
         )
         return false
      }

      ui.notifications.warn(
         tKey("Notifications.CapacityAdjusted", {
            qty: allowedIncoming,
            name: item.name,
         }),
      )
      item.updateSource({ "system.quantity": allowedIncoming })
   }

   static onPreUpdateItem(item, changes) {
      const actor = item.parent
      if (!actor || !isSiege(actor) || !this.isAmmoItem(item)) return
      if (changes.system?.quantity === undefined) return

      const slug = item.system?.slug || slugify(item.name)
      const ammoTypes = actor.getFlag(MODULE_ID, "ammunitionTypes") || []
      const allowedType = ammoTypes.find(
         (t) => slugify(t.slug || t.name) === slug,
      )
      if (!allowedType || allowedType.max === "") return

      const maxCap = parseInt(allowedType.max)
      const otherQty = this.getCurrentAmmoCount(actor, slug) - item.system.quantity
      if (otherQty + changes.system.quantity > maxCap) {
         ui.notifications.warn(tKey("Notifications.MaxCapacityReachedGeneric"))
         changes.system.quantity = Math.max(0, maxCap - otherQty)
      }
   }

   static async syncLoadedEffects(actor) {
      if (!actor || !isSiege(actor)) return

      const ammoItems = actor.items.filter((i) => this.isAmmoItem(i))
      const counts = {}
      const images = {}
      for (const a of ammoItems) {
         const slug = a.system?.slug || slugify(a.name)
         counts[slug] = (counts[slug] || 0) + (a.system?.quantity || 1)
         images[slug] = a.img
      }

      const ammoTypes = actor.getFlag(MODULE_ID, "ammunitionTypes") || []
      for (const t of ammoTypes) {
         const tSlug = slugify(t.slug || t.name)
         const qty = counts[tSlug] || 0
         const effectName = tKey("Markers.LoadedPrefix", { name: t.name })
         const img = images[tSlug] || DEFAULT_AMMO_IMG

         const existing = actor.itemTypes.effect.find(
            (e) =>
               e.name === effectName && e.getFlag(MODULE_ID, "isLoadedMarker"),
         )

         if (qty > 0) {
            if (existing) {
               if (
                  existing.system.badge?.value !== qty ||
                  existing.img !== img
               ) {
                  await existing.update({ "system.badge.value": qty, img })
               }
            } else {
               await actor.createEmbeddedDocuments("Item", [
                  {
                     name: effectName,
                     type: "effect",
                     img,
                     system: {
                        level: { value: 1 },
                        badge: { type: "counter", value: qty },
                        description: {
                           value: tKey("Markers.LoadedDesc", {
                              qty,
                              name: t.name,
                           }),
                        },
                        tokenIcon: { show: true },
                     },
                     flags: { [MODULE_ID]: { isLoadedMarker: true } },
                  },
               ])
            }
         } else if (existing) {
            await existing.delete()
         }
      }
   }

   static isAmmoItem(item) {
      if (item.isAmmo) return true
      if (item.type === "ammunition" || item.type === "ammo") return true
      if (
         item.type === "consumable" ||
         (item.isOfType && item.isOfType("consumable"))
      ) {
         const cat = item.system?.category?.value || item.system?.category
         return cat === "ammo" || cat === "munition"
      }
      return false
   }

   static validateItem(item, actor) {
      if (!this.isAmmoItem(item)) return false
      const ammoTypes = actor.getFlag(MODULE_ID, "ammunitionTypes") || []
      const itemSlug = item.system?.slug || slugify(item.name)
      return ammoTypes.some((t) => slugify(t.slug || t.name) === itemSlug)
   }

   static getCurrentAmmoCount(actor, slug) {
      return actor.items
         .filter(
            (i) =>
               this.isAmmoItem(i) &&
               (i.system?.slug || slugify(i.name)) === slug,
         )
         .reduce((sum, i) => sum + (i.system?.quantity || 1), 0)
   }

   static async reduceAmmoToMax(actor, slug, maxCap) {
      const items = actor.items.filter(
         (i) =>
            this.isAmmoItem(i) &&
            (i.system?.slug || slugify(i.name)) === slug,
      )
      const currentCount = items.reduce(
         (sum, i) => sum + (i.system?.quantity || 1),
         0,
      )
      let excess = currentCount - maxCap

      for (const item of items) {
         if (excess <= 0) break
         const qty = item.system?.quantity || 1
         if (qty <= excess) {
            excess -= qty
            await item.delete()
         } else {
            await item.update({ "system.quantity": qty - excess })
            excess = 0
         }
      }
   }

   static async syncAmmoFromEffect(effect) {
      const actor = effect.parent
      if (!actor) return

      const badgeValue = effect.system.badge?.value
      if (badgeValue === undefined) return

      const ammoName = effect.name.replace(/^Loaded: /, "")
      const slug = slugify(ammoName)

      const ammoItems = actor.items.filter(
         (i) =>
            this.isAmmoItem(i) &&
            (i.system?.slug || slugify(i.name)) === slug,
      )
      const currentQty = ammoItems.reduce(
         (sum, i) => sum + (i.system?.quantity || 1),
         0,
      )

      if (currentQty === badgeValue) return

      if (badgeValue < currentQty) {
         await this.reduceAmmoToMax(actor, slug, badgeValue)
         return
      }

      const diff = badgeValue - currentQty
      if (ammoItems.length > 0) {
         const primary = ammoItems[0]
         await primary.update({
            "system.quantity": (primary.system.quantity || 1) + diff,
         })
         return
      }

      const ammoTypes = actor.getFlag(MODULE_ID, "ammunitionTypes") || []
      const tInfo = ammoTypes.find((t) => slugify(t.slug || t.name) === slug)
      if (!tInfo) return

      await actor.createEmbeddedDocuments("Item", [
         {
            name: tInfo.name,
            type: "consumable",
            img: effect.img || DEFAULT_AMMO_IMG,
            system: { category: "ammo", slug, quantity: diff },
         },
      ])
   }
}
