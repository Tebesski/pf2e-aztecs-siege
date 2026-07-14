import { MODULE_ID, DEFAULT_AMMO_IMG, PHYSICAL_ITEM_TYPES } from "../../constants.mjs"
import { slugify, splitCSV, tKey } from "../../utils.mjs"
import { SiegeSFXManager } from "../sfx.mjs"
import { AMMO_LOAD_SOURCE_PRIORITY } from "./helpers.mjs"

class AmmunitionStockMutationMixin {
   static async _addUnits(actor, slug, units, tpl = null) {
      let remaining = units
      const existing = this._ammoItemsFor(actor, slug)
      
      for (const item of existing) {
         if (remaining <= 0) break
         const charge = this._chargeInfo(item)
         if (!charge.usesCharges) continue
         const room = charge.max - charge.value
         if (room <= 0) continue
         const add = Math.min(room, remaining)
         remaining -= add
         await item.update({ [charge.path]: charge.value + add })
      }
      if (remaining <= 0) return true

let template = tpl
      if (!template && existing[0]) {
         template = existing[0].toObject()
         delete template._id
         delete template.ownership
      }
      if (!template) {
         const type = (actor.getFlag(MODULE_ID, "ammunitionTypes") || []).find(
            (t) => slugify(t.slug || t.name) === slug || slugify(t.name) === slug,
         )
         template = {
            name: type?.name || slug.replace(/-/g, " ") || "Ammunition",
            type: "consumable",
            img: type?.img || DEFAULT_AMMO_IMG,
            system: {
               quantity: 1,
               category: { value: "ammo" },
               slug: type?.slug ? slugify(type.slug) : slug,
            },
         }
      }

      const templateCharge = this._chargeInfo(template)
      const existingCharge = this._chargeInfo(existing[0])
      const maxUses = templateCharge.max || existingCharge.max || 0
      const chargeKey = templateCharge.key || existingCharge.key || "uses"
      if (maxUses > 0) {
         const full = Math.floor(remaining / maxUses)
         const partial = remaining % maxUses
         const toCreate = []
         if (full > 0) {
            const t = foundry.utils.deepClone(template)
            t.system.quantity = full
            this._setChargeValueOnData(t, maxUses, chargeKey, maxUses)
            toCreate.push(t)
         }
         if (partial > 0) {
            const t = foundry.utils.deepClone(template)
            t.system.quantity = 1
            this._setChargeValueOnData(t, partial, chargeKey, maxUses)
            toCreate.push(t)
         }
         if (toCreate.length) await actor.createEmbeddedDocuments("Item", toCreate)
         remaining = 0
      } else if (existing.length > 0) {
         
         const item = existing[0]
         await item.update({
            "system.quantity": (item.system?.quantity || 1) + remaining,
         })
         remaining = 0
      } else {
         const t = foundry.utils.deepClone(template)
         t.system = t.system || {}
         t.system.quantity = remaining
         await actor.createEmbeddedDocuments("Item", [t])
         remaining = 0
      }
      return remaining <= 0
   }

   static async _addChargedUnits(actor, slug, charges, tpl = null) {
      const clean = (charges || [])
         .map((n) => Math.max(0, Number(n) || 0))
         .filter((n) => n > 0)
      if (clean.length === 0) return true

      let template = tpl
      const existing = this._ammoItemsFor(actor, slug)
      if (!template && existing[0]) {
         template = existing[0].toObject()
         delete template._id
         delete template.ownership
      }
      if (!template) {
         const type = (actor.getFlag(MODULE_ID, "ammunitionTypes") || []).find(
            (t) => slugify(t.slug || t.name) === slug || slugify(t.name) === slug,
         )
         template = {
            name: type?.name || slug.replace(/-/g, " ") || "Ammunition",
            type: "consumable",
            img: type?.img || DEFAULT_AMMO_IMG,
            system: {
               quantity: 1,
               category: { value: "ammo" },
               slug: type?.slug ? slugify(type.slug) : slug,
               uses: { value: 1, max: 1, autoDestroy: true },
            },
         }
      }

      const templateCharge = this._chargeInfo(template)
      const existingCharge = this._chargeInfo(existing[0])
      const maxUses =
         templateCharge.max ||
         existingCharge.max ||
         Math.max(1, ...clean)
      const chargeKey = templateCharge.key || existingCharge.key || "uses"

      const byValue = new Map()
      for (const value of clean) {
         const key = Math.min(maxUses, value)
         byValue.set(key, (byValue.get(key) || 0) + 1)
      }

      for (const [value, qty] of byValue) {
         const stack = existing.find((item) => {
            const charge = this._chargeInfo(item)
            return (
               charge.usesCharges &&
               charge.max === maxUses &&
               charge.value === value
            )
         })
         if (stack) {
            await stack.update({
               "system.quantity": (Number(stack.system?.quantity) || 1) + qty,
            })
            byValue.delete(value)
         }
      }

      const toCreate = [...byValue.entries()].map(([value, qty]) => {
         const t = foundry.utils.deepClone(template)
         delete t._id
         delete t.ownership
         t.system = t.system || {}
         t.system.quantity = qty
         this._setChargeValueOnData(t, value, chargeKey, maxUses)
         return t
      })
      if (toCreate.length) await actor.createEmbeddedDocuments("Item", toCreate)
      return true
   }

   static async _addChargedPieces(actor, slug, pieces) {
      const clean = (pieces || [])
         .map((piece, index) => this._normalizeLoadedPiece(piece, index))
         .filter(Boolean)
      for (const piece of clean) {
         await this._addChargedUnits(
            actor,
            piece.slug || slug,
            [piece.charges],
            piece.template,
         )
      }
      return true
   }

static async _consumeUnits(actor, slug, units) {
      let remaining = units
      const items = this._ammoItemsFor(actor, slug)
      for (const item of items) {
         if (remaining <= 0) break
         const qty = item.system?.quantity || 1
         const charge = this._chargeInfo(item)
         const itemUnits = charge.usesCharges
            ? (qty - 1) * charge.max + charge.value
            : qty
         const take = Math.min(itemUnits, remaining)
         const left = itemUnits - take
         remaining -= take
         if (left <= 0) {
            await item.delete()
         } else if (charge.usesCharges) {
            const newQty = Math.ceil(left / charge.max)
            const newUses = left % charge.max === 0 ? charge.max : left % charge.max
            await item.update({
               "system.quantity": newQty,
               [charge.path]: newUses,
            })
         } else {
            await item.update({ "system.quantity": left })
         }
      }
      return remaining <= 0
   }

   static async _extractLoadedUnits(
      actor,
      slug,
      units,
      preferredItemId = null,
      contextActor = null,
   ) {
      let remaining = units
      const charges = []
      const pieces = []
      let template = null
      const items = this._ammoItemsFor(actor, slug, contextActor).sort((a, b) => {
         if (!preferredItemId) return 0
         if (a.id === preferredItemId) return -1
         if (b.id === preferredItemId) return 1
         return 0
      })
      for (const item of items) {
         if (remaining <= 0) break
         const charge = this._chargeInfo(item)
         if (!charge.usesCharges) continue
         if (!template) template = this._templateFromItem(item)
         const qty = Number(item.system?.quantity) || 1
         const stack = [
            charge.value || charge.max,
            ...Array.from({ length: Math.max(0, qty - 1) }, () => charge.max),
         ].filter((n) => n > 0)
         const take = Math.min(remaining, stack.length)
         charges.push(...stack.slice(0, take))
         pieces.push(
            ...stack
               .slice(0, take)
               .map((value, index) =>
                  this._pieceFromTemplate(
                     template,
                     value,
                     pieces.length + index,
                     slug,
                  ),
               )
               .filter(Boolean),
         )
         remaining -= take
         const left = stack.slice(take)
         if (left.length === 0) {
            await item.delete()
         } else {
            await item.update({
               "system.quantity": left.length,
               [charge.path]: left[0],
            })
         }
      }
      return { ok: remaining <= 0, charges, pieces, template }
   }

   static async _consumeNonChargedLoadUnitsFromSources(
      vehicle,
      slug,
      units,
      sources = [vehicle],
   ) {
      let remaining = units
      let template = null
      for (const source of sources) {
         if (remaining <= 0) break
         const items = this._ammoItemsFor(source, slug, vehicle)
         for (const item of items) {
            if (remaining <= 0) break
            if (this._chargeInfo(item).usesCharges) continue
            if (!template) template = this._templateFromItem(item)
            const qty = Number(item.system?.quantity) || 1
            const take = Math.min(qty, remaining)
            const left = qty - take
            remaining -= take
            if (left <= 0) await item.delete()
            else await item.update({ "system.quantity": left })
         }
      }
      return { ok: remaining <= 0, taken: units - remaining, template }
   }

   static async _extractChargedLoadUnitsFromSources(
      vehicle,
      slug,
      units,
      sources = [vehicle],
   ) {
      let remaining = units
      const charges = []
      const pieces = []
      let template = null
      for (const source of sources) {
         if (remaining <= 0) break
         const available = this.getAvailableLoadUnitsForSource(
            source,
            slug,
            vehicle,
         )
         const take = Math.min(remaining, available)
         if (take <= 0) continue
         const extracted = await this._extractLoadedUnits(
            source,
            slug,
            take,
            null,
            vehicle,
         )
         if (!extracted.ok) continue
         remaining -= take
         charges.push(...extracted.charges)
         pieces.push(...extracted.pieces)
         if (!template) template = extracted.template
      }
      return { ok: remaining <= 0, charges, pieces, template }
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

      const sourceItem = await this._findOrFetchSource(slug)
      if (sourceItem) {
         const itemData = sourceItem.toObject()
         itemData.system.quantity = diff
         itemData.img = effect.img || itemData.img || DEFAULT_AMMO_IMG
         delete itemData._id
         delete itemData.ownership
         await actor.createEmbeddedDocuments("Item", [itemData])
         return
      }

      await actor.createEmbeddedDocuments("Item", [
         {
            name: tInfo.name,
            type: "consumable",
            img: effect.img || DEFAULT_AMMO_IMG,
            system: { category: "ammo", slug, quantity: diff },
         },
      ])
   }

   static async _findOrFetchSource(slug) {
      const direct = game.items.find(
         (i) =>
            this.isAmmoItem(i) &&
            (i.system?.slug || slugify(i.name)) === slug,
      )
      if (direct) return direct

      for (const pack of game.packs.filter((p) => p.documentName === "Item")) {
         const index =
            pack.index.length > 0
               ? pack.index
               : await pack.getIndex({ fields: ["system.slug"] })
         const entry = index.find(
            (e) => (e.system?.slug || slugify(e.name)) === slug,
         )
         if (entry) return pack.getDocument(entry._id)
      }
      return null
   }}

export const ammunitionStockMutationMethods = Object.fromEntries(
   Object.getOwnPropertyNames(AmmunitionStockMutationMixin)
      .filter((name) => !["length", "name", "prototype"].includes(name))
      .map((name) => [name, AmmunitionStockMutationMixin[name]]),
)