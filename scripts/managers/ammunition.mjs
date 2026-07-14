import {
   MODULE_ID,
   DEFAULT_AMMO_IMG,
} from "../constants.mjs"
import { slugify, isSiege, tKey } from "../utils.mjs"
import { SiegeCrewManager } from "./crew.mjs"
import { ammunitionInventoryMethods } from "./ammunition/inventory.mjs"
import { ammunitionLoadedStateMethods } from "./ammunition/loaded-state.mjs"
import { ammunitionReloadFlowMethods } from "./ammunition/reload-flow.mjs"
import { ammunitionStockMutationMethods } from "./ammunition/stock-mutations.mjs"

export class AmmunitionManager {
   static initHooks() {
      Hooks.on("preCreateItem", (item, data, options, userId) =>
         this.onPreCreateItem(item, data, options, userId),
      )
      Hooks.on("preUpdateItem", (item, changes, options, userId) =>
         this.onPreUpdateItem(item, changes, options, userId),
      )
      Hooks.on("preDeleteItem", (item, options, userId) =>
         this.onPreDeleteItem(item, options, userId),
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

   static loadProgressEffectsForAction(vehicle, action) {
      if (!vehicle || !action) return []
      const fallbackName = tKey("Markers.LoadPerformed", { name: action.name })
      return vehicle.itemTypes.effect.filter(
         (effect) =>
            (effect.getFlag(MODULE_ID, "isLoadPerformed") &&
               effect.getFlag(MODULE_ID, "actionId") === action.id) ||
            effect.name === fallbackName,
      )
   }

   static async clearLoadProgressForAction(vehicle, action) {
      const effects = this.loadProgressEffectsForAction(vehicle, action)
      if (effects.length === 0) return
      await vehicle.deleteEmbeddedDocuments(
         "Item",
         effects.map((effect) => effect.id),
         { siegeLoadProgressSync: true },
      )
   }

   static onItemChange(item, userId) {
      if (game.user.id !== userId) return
      if (!item.parent || !isSiege(item.parent)) return

if (item.type === "action") {
         SiegeCrewManager.syncCrewEffects(item.parent)
      }
   }

   static async onItemDelete(item, userId) {
      const actor = item.parent
      if (!actor || !isSiege(actor)) return
      if (
         item.type === "effect" &&
         (item.getFlag(MODULE_ID, "isStrikeLoadedMarker") ||
            item.getFlag(MODULE_ID, "isLoadedMarker"))
      ) {
         await this.syncStrikeLoadedEffects(actor)
         return
      }
      if (game.user.id !== userId) return
      
      if (item.type === "action") {
         const map = actor.getFlag(MODULE_ID, "loadedByStrike") || {}
         if (map[item.id] !== undefined) {
            await this.setStrikeLoaded(actor, item.id, 0)
         }
      }
   }

   static onPreCreateItem(item) {
      const actor = item.parent
      if (!actor || !isSiege(actor)) return

}

   static onPreUpdateItem(item, changes, options = {}) {
      const actor = item?.parent
      if (
         actor &&
         isSiege(actor) &&
         item.type === "effect" &&
         (item.getFlag(MODULE_ID, "isStrikeLoadedMarker") ||
            item.getFlag(MODULE_ID, "isLoadedMarker")) &&
         foundry.utils.getProperty(changes, "system.badge.value") !== undefined &&
         !options.siegeAmmoSync
      ) {
         ui.notifications.warn(tKey("Notifications.LoadedEffectManaged"))
         return false
      }

}

   static onPreDeleteItem(item, options = {}) {
      const actor = item.parent
      if (!actor || !isSiege(actor) || item.type !== "effect") return
      const isLoadedMarker =
         item.getFlag(MODULE_ID, "isStrikeLoadedMarker") ||
         item.getFlag(MODULE_ID, "isLoadedMarker")
      if (!isLoadedMarker) return
      if (options.siegeAmmoSync || options.systemDeletion) return
      ui.notifications.warn(tKey("Notifications.LoadedEffectManaged"))
      return false
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
                  await existing.update(
                     { "system.badge.value": qty, img },
                     { siegeAmmoSync: true },
                  )
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
            await existing.delete({ siegeAmmoSync: true })
         }
      }
   }

   static _loadedAmmoTypeSlugs(vehicle, action, pieces = null) {
      const loadedPieces = pieces || this.getLoadedAmmoPieces(vehicle, action)
      const slugs = new Set(
         loadedPieces
            .map((piece) => slugify(piece.slug || piece.name))
            .filter(Boolean),
      )
      if (slugs.size === 0 && this.getStrikeLoaded(vehicle, action) > 0) {
         const activeSlug = this.activeAmmoSlug(vehicle, action)
         if (activeSlug) slugs.add(slugify(activeSlug))
      }
      return slugs
   }

   static async _confirmReplaceLoadedAmmoType(vehicle, action, targetSlug) {
      const loadedLabel = this.activeAmmoLabel(vehicle, action)
      const targetLabel = this.ammoTypeLabel(vehicle, targetSlug)
      return foundry.applications.api.DialogV2.wait({
         classes: ["siege-v2-dialog"],
         window: { title: tKey("Weaponry.ReplaceTitle") },
         content: `<p>${tKey("Weaponry.ReplaceLoadedAmmoTypePrompt", {
            current: loadedLabel,
            next: targetLabel,
            name: action.name,
         })}</p>`,
         buttons: [
            {
               action: "replace",
               label: tKey("Weaponry.Replace"),
               icon: "fa-solid fa-rotate",
               default: true,
               callback: () => true,
            },
            {
               action: "cancel",
               label: tKey("CrewHUD.Cancel"),
               callback: () => false,
            },
         ],
      }).catch(() => false)
   }

   static async _returnLoadedAmmoToStash(vehicle, action, pieces = null) {
      const loadedPieces = pieces || this.getLoadedAmmoPieces(vehicle, action)
      const fallbackSlug = this.activeAmmoSlug(vehicle, action)
      if (loadedPieces.length > 0) {
         for (const piece of loadedPieces) {
            const slug = piece.slug || fallbackSlug
            if (piece.usesCharges)
               await this._addChargedPieces(vehicle, slug, [piece])
            else await this._addUnits(vehicle, slug, 1, piece.template)
         }
      } else {
         const loaded = this.getStrikeLoaded(vehicle, action)
         const template = this.getLoadedAmmoTemplate(vehicle, action)
         if (loaded > 0 && fallbackSlug)
            await this._addUnits(vehicle, fallbackSlug, loaded, template)
      }
      await this.setLoadedAmmoPieces(vehicle, action.id, [], null)
      await this.setStrikeLoadedCharges(vehicle, action.id, [])
      await this.setStrikeLoaded(vehicle, action.id, 0)
   }

   static async _ensureSingleLoadedAmmoType(
      vehicle,
      action,
      targetSlug,
      pieces = null,
      options = {},
   ) {
      const target = slugify(targetSlug)
      if (!target) return true
      const loadedSlugs = this._loadedAmmoTypeSlugs(vehicle, action, pieces)
      if (loadedSlugs.size === 0) return true
      const targetCandidates = this._candidateSlugs(vehicle, target)
      if ([...loadedSlugs].every((slug) => targetCandidates.has(slug)))
         return true
      const confirmed =
         options.confirmedReplace === true ||
         (await this._confirmReplaceLoadedAmmoType(vehicle, action, target))
      if (!confirmed) return false
      await this._returnLoadedAmmoToStash(vehicle, action, pieces)
      return true
   }


}

Object.assign(
   AmmunitionManager,
   ammunitionInventoryMethods,
   ammunitionLoadedStateMethods,
   ammunitionReloadFlowMethods,
   ammunitionStockMutationMethods,
)
