import { MODULE_ID, DEFAULT_AMMO_IMG, PHYSICAL_ITEM_TYPES } from "../../constants.mjs"
import { slugify, splitCSV, tKey } from "../../utils.mjs"
import { SiegeSFXManager } from "../sfx.mjs"
import { AMMO_LOAD_SOURCE_PRIORITY } from "./helpers.mjs"

class AmmunitionInventoryMixin {
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

   static ammoTypeFor(actor, slug) {
      const target = slugify(slug)
      if (!actor || !target) return null
      return (actor.getFlag(MODULE_ID, "ammunitionTypes") || []).find(
         (t) => slugify(t.slug || t.name) === target,
      )
   }

   static ammoTypeLabel(actor, slug) {
      return (
         this.ammoTypeFor(actor, slug)?.name ||
         tKey("Ammunition.TypeUnassigned")
      )
   }

   static ammoSlugsForAction(actionOrFlag) {
      const flag = actionOrFlag?.getFlag
         ? actionOrFlag.getFlag(MODULE_ID, "siegeAction") || {}
         : actionOrFlag || {}
      const slugs = []
      const addSlug = (value) => {
         const slug = slugify(value)
         if (slug && !slugs.includes(slug)) slugs.push(slug)
      }
      if (Array.isArray(flag.ammoSlugs)) flag.ammoSlugs.forEach(addSlug)
      addSlug(flag.ammoSlug)
      return slugs
   }

   static primaryAmmoSlugForAction(actionOrFlag) {
      return this.ammoSlugsForAction(actionOrFlag)[0] || ""
   }

   static ammoTypesForAction(actor, actionOrFlag) {
      return this.ammoSlugsForAction(actionOrFlag)
         .map((slug) => ({ slug, type: this.ammoTypeFor(actor, slug) }))
         .filter((entry) => !!entry.type)
   }

   static activeAmmoSlug(vehicle, action) {
      const active = this.getActiveLoadedPiece(vehicle, action)
      if (active?.slug) return slugify(active.slug)
      const tpl = this.getLoadedAmmoTemplate(vehicle, action)
      const tplSlug = this._slugFromTemplate(tpl)
      if (tplSlug) return tplSlug
      return this.primaryAmmoSlugForAction(action)
   }

   static activeAmmoLabel(vehicle, action) {
      const active = this.getActiveLoadedPiece(vehicle, action)
      if (active?.name) return active.name
      const slug = this.activeAmmoSlug(vehicle, action)
      return this.ammoTypeLabel(vehicle, slug)
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

static _candidateSlugs(actor, slug, contextActor = null) {
      const set = new Set([slug])
      const actors = [actor, contextActor].filter(Boolean)
      for (const source of actors) {
         const types = Object.values(
            source.getFlag?.(MODULE_ID, "ammunitionTypes") || {},
         )
         const t = types.find(
            (x) =>
               slugify(x.slug || x.name) === slug || slugify(x.name) === slug,
         )
         if (t) {
            if (t.slug) set.add(slugify(t.slug))
            if (t.name) set.add(slugify(t.name))
         }
      }
      return set
   }

   static _ammoItemsFor(actor, slug, contextActor = null) {
      const slugs = this._candidateSlugs(actor, slug, contextActor)
      const matches = actor.items.filter((i) => {
         if (!this.isAmmoItem(i)) return false
         const itemSlug = i.system?.slug || slugify(i.name)
         return slugs.has(itemSlug) || slugs.has(slugify(i.name))
      })
      if (matches.length > 0) return matches

const stems = [...slugs]
         .map((s) => s.replace(/s$/, ""))
         .filter((s) => s.length >= 3)
      return actor.items.filter((i) => {
         if (!this.isAmmoItem(i)) return false
         const itemSlug = i.system?.slug || slugify(i.name)
         const nameSlug = slugify(i.name)
         return stems.some(
            (st) =>
               itemSlug.includes(st) ||
               nameSlug.includes(st) ||
               st.includes(itemSlug),
         )
      })
   }

   static _chargeInfoFromSystem(system = {}) {
      const uses = system?.uses
      const charges = system?.charges
      const max = Number(uses?.max ?? charges?.max ?? 0) || 0
      if (max <= 1)
         return { usesCharges: false, max: 0, value: 0, path: null, key: null }
      const rawValue = uses?.value ?? charges?.value ?? max
      const value = Math.max(0, Math.min(max, Number(rawValue) || 0))
      const key = uses ? "uses" : "charges"
      return {
         usesCharges: true,
         max,
         value,
         path: `system.${key}.value`,
         key,
      }
   }

   static _chargeInfo(itemOrData) {
      return this._chargeInfoFromSystem(itemOrData?.system || {})
   }

   static _setChargeValueOnData(data, value, preferredKey = null, max = null) {
      data.system = data.system || {}
      const key =
         preferredKey ||
         (data.system.uses ? "uses" : data.system.charges ? "charges" : "uses")
      data.system[key] = data.system[key] || {}
      if (max != null && data.system[key].max == null) data.system[key].max = max
      data.system[key].value = value
   }

static getAvailableUnits(actor, slug) {
      return this.getAvailableUnitsForSource(actor, slug, actor)
   }

   static getAvailableUnitsForSource(actor, slug, contextActor = actor) {
      const items = this._ammoItemsFor(actor, slug, contextActor)
      let total = 0
      for (const i of items) {
         const qty = i.system?.quantity || 1
         const charge = this._chargeInfo(i)
         total += charge.usesCharges
            ? (qty - 1) * charge.max + charge.value
            : qty
      }
      return total
   }

static getAvailableLoadUnits(actor, slug) {
      return this.getAvailableLoadUnitsForSource(actor, slug, actor)
   }

   static getAvailableLoadUnitsForSource(actor, slug, contextActor = actor) {
      const items = this._ammoItemsFor(actor, slug, contextActor)
      if (!items.length) return 0
      const usesCharges = items.some((i) => this._chargeInfo(i).usesCharges)
      if (!usesCharges)
         return this.getAvailableUnitsForSource(actor, slug, contextActor)
      return items.reduce((sum, i) => {
         if (!this._chargeInfo(i).usesCharges) return sum
         return sum + (Number(i.system?.quantity) || 1)
      }, 0)
   }

   static _tokenRect(token) {
      const grid = canvas?.grid?.size || canvas?.dimensions?.size || 100
      const doc = token.document ?? token
      const x = doc.x ?? token.x ?? 0
      const y = doc.y ?? token.y ?? 0
      const w = (doc.width ?? 1) * grid
      const h = (doc.height ?? 1) * grid
      return { left: x, top: y, right: x + w, bottom: y + h }
   }

   static _tokensAdjacent(a, b) {
      if (!a || !b) return false
      const grid = canvas?.grid?.size || canvas?.dimensions?.size || 100
      const ra = this._tokenRect(a)
      const rb = this._tokenRect(b)
      const gapX = Math.max(0, rb.left - ra.right, ra.left - rb.right)
      const gapY = Math.max(0, rb.top - ra.bottom, ra.top - rb.bottom)
      const tol = grid * 0.34
      return gapX <= tol && gapY <= tol
   }

   static _firstToken(actor) {
      return actor?.getActiveTokens?.()[0] || null
   }

   static async _resolveActor(ref) {
      if (!ref) return null
      if (ref.documentName === "Actor") return ref
      if (ref.actor) return ref.actor
      if (typeof ref !== "string") return null
      const doc = await fromUuid(ref).catch(() => null)
      return doc?.actor ?? (doc?.documentName === "Actor" ? doc : null)
   }

   static _isEligibleAdjacentAmmoSource(actor) {
      if (!actor) return false
      const type = actor.type?.toLowerCase()
      if (type === "hazard") return false
      return AMMO_LOAD_SOURCE_PRIORITY.includes(type)
   }

   static _ammoLoadSourceRank(actor, vehicle) {
      if (vehicle && actor?.id === vehicle.id) return 0
      const idx = AMMO_LOAD_SOURCE_PRIORITY.indexOf(actor?.type?.toLowerCase())
      return idx === -1 ? Number.MAX_SAFE_INTEGER : idx + 1
   }

   static async collectLoadSources(vehicle, crewmanRef = null, options = {}) {
      const sources = []
      const push = (actor) => {
         if (!actor || sources.some((existing) => existing.uuid === actor.uuid))
            return
         sources.push(actor)
      }
      push(vehicle)

      const includeAdjacent = options.includeAdjacent !== false
      const crewman = await this._resolveActor(crewmanRef)
      if (!includeAdjacent || !crewman) {
         return sources
      }

      const crewmanAboard = crewman.itemTypes?.effect?.some(
         (effect) =>
            effect.getFlag(MODULE_ID, "siegeId") === vehicle?.id &&
            effect.getFlag(MODULE_ID, "position"),
      )
      if (crewmanAboard) push(crewman)

      if (!canvas?.tokens?.placeables) return sources

      const vehicleToken = this._firstToken(vehicle)
      const crewToken = this._firstToken(crewman)
      if (!vehicleToken || !crewToken) return sources
      if (!crewmanAboard && !this._tokensAdjacent(vehicleToken, crewToken))
         return sources

      push(crewman)
      for (const token of canvas.tokens.placeables) {
         const actor = token.actor
         if (!actor || token.id === vehicleToken.id) continue
         if (actor.id === crewman.id || actor.id === vehicle.id) continue
         if (!this._isEligibleAdjacentAmmoSource(actor)) continue
         if (
            this._tokensAdjacent(vehicleToken, token) &&
            this._tokensAdjacent(crewToken, token)
         ) {
            push(actor)
         }
      }

      return sources.sort(
         (a, b) =>
            this._ammoLoadSourceRank(a, vehicle) -
            this._ammoLoadSourceRank(b, vehicle),
      )
   }

   static getAvailableLoadUnitsFromSources(vehicle, slug, sources = [vehicle]) {
      return sources.reduce(
         (sum, actor) =>
            sum + this.getAvailableLoadUnitsForSource(actor, slug, vehicle),
         0,
      )
   }

   static ammoUsesChargesFromSources(vehicle, slug, sources = [vehicle]) {
      return sources.some((actor) =>
         this._ammoItemsFor(actor, slug, vehicle).some(
            (item) => this._chargeInfo(item).usesCharges,
         ),
      )
   }

static ammoUsesCharges(actor, slug) {
      const item = this._ammoItemsFor(actor, slug)[0]
      if (this._chargeInfo(item).usesCharges) return true
      const slugs = this._candidateSlugs(actor, slug)
      const templates = Object.values(
         actor?.getFlag?.(MODULE_ID, "loadedAmmoTemplates") || {},
      )
      return templates.some((tpl) => {
         const tplSlug = slugify(tpl?.system?.slug || tpl?.name)
         const nameSlug = slugify(tpl?.name)
         return (
            (slugs.has(tplSlug) || slugs.has(nameSlug)) &&
            this._chargeInfo(tpl).usesCharges
         )
      })
   }

}

export const ammunitionInventoryMethods = Object.fromEntries(
   Object.getOwnPropertyNames(AmmunitionInventoryMixin)
      .filter((name) => !["length", "name", "prototype"].includes(name))
      .map((name) => [name, AmmunitionInventoryMixin[name]]),
)
