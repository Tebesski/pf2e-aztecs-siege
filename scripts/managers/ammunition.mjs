import {
   MODULE_ID,
   DEFAULT_AMMO_IMG,
   PHYSICAL_ITEM_TYPES,
} from "../constants.mjs"
import { slugify, isSiege, splitCSV, tKey } from "../utils.mjs"
import { SiegeCrewManager } from "./crew.mjs"
import { SiegeSFXManager } from "./sfx.mjs"

const DEFAULT_AMMO_DAMAGE_PART = {
   dice: 1,
   die: "d6",
   type: "bludgeoning",
   category: "normal",
}

const AMMO_LOAD_SOURCE_PRIORITY = [
   "loot",
   "npc",
   "familiar",
   "character",
   "vehicle",
]

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
      if (!includeAdjacent || !crewman || !canvas?.tokens?.placeables) {
         return sources
      }

      const vehicleToken = this._firstToken(vehicle)
      const crewToken = this._firstToken(crewman)
      if (!vehicleToken || !crewToken) return sources
      if (!this._tokensAdjacent(vehicleToken, crewToken)) return sources

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

   
   
   

   static getStrikeLoaded(vehicle, action) {
      if (!vehicle || !action) return 0
      const map = vehicle.getFlag(MODULE_ID, "loadedByStrike") || {}
      return Number(map[action.id]) || 0
   }

   static strikeMaxLoaded(action) {
      const flag = action?.getFlag?.(MODULE_ID, "siegeAction") || {}
      return parseInt(flag.maxLoaded) || 1
   }

   static getStrikeLoadedCharges(vehicle, action) {
      if (!vehicle || !action) return []
      const map = vehicle.getFlag(MODULE_ID, "loadedAmmoChargesByStrike") || {}
      return Array.isArray(map[action.id]) ? [...map[action.id]] : []
   }

   static getLoadedAmmoTemplate(vehicle, actionOrId) {
      const actionId =
         typeof actionOrId === "string" ? actionOrId : actionOrId?.id
      if (!vehicle || !actionId) return null
      const templates = vehicle.getFlag(MODULE_ID, "loadedAmmoTemplates") || {}
      return templates[actionId] || null
   }

   static getLoadedAmmoPieces(vehicle, action) {
      if (!vehicle || !action) return []
      const map = vehicle.getFlag(MODULE_ID, "loadedAmmoPiecesByStrike") || {}
      const entry = map[action.id]
      if (entry?.pieces && Array.isArray(entry.pieces)) {
         return entry.pieces
            .map((piece, index) => this._normalizeLoadedPiece(piece, index))
            .filter(Boolean)
      }

      const charges = this.getStrikeLoadedCharges(vehicle, action)
      const tpl = this.getLoadedAmmoTemplate(vehicle, action)
      const charge = this._chargeInfo(tpl)
      const loaded = this.getStrikeLoaded(vehicle, action)
      if (!charge.usesCharges) {
         if (loaded <= 0 || !tpl) return []
         return Array.from({ length: loaded }, (_v, index) =>
            this._pieceFromTemplate(
               tpl,
               1,
               index,
               this._slugFromTemplate(tpl) || this.primaryAmmoSlugForAction(action),
            ),
         ).filter(Boolean)
      }
      const seeded =
         charges.length > 0
            ? charges
            : Array.from({ length: loaded }, () => charge.max)
      return seeded.map((value, index) =>
         this._pieceFromTemplate(
            tpl,
            value,
            index,
            this._slugFromTemplate(tpl) || this.primaryAmmoSlugForAction(action),
         ),
      )
   }

   static getActiveLoadedPieceId(vehicle, action) {
      const map = vehicle?.getFlag?.(MODULE_ID, "loadedAmmoPiecesByStrike") || {}
      const entry = map[action?.id]
      const pieces = this.getLoadedAmmoPieces(vehicle, action)
      if (pieces.some((piece) => piece.id === entry?.activeId))
         return entry.activeId
      return pieces[0]?.id || null
   }

   static getActiveLoadedPiece(vehicle, action) {
      const activeId = this.getActiveLoadedPieceId(vehicle, action)
      return (
         this.getLoadedAmmoPieces(vehicle, action).find(
            (piece) => piece.id === activeId,
         ) || null
      )
   }

   static getLoadedAmmoPiecesForSlug(vehicle, action, slug) {
      const target = slugify(slug)
      if (!target) return []
      return this.getLoadedAmmoPieces(vehicle, action).filter(
         (piece) => slugify(piece.slug) === target,
      )
   }

   static loadedInfoForAction(vehicle, action, slug = null) {
      const active = this.getActiveLoadedPiece(vehicle, action)
      const targetSlug = slugify(slug || active?.slug || this.activeAmmoSlug(vehicle, action))
      const pieces = targetSlug
         ? this.getLoadedAmmoPiecesForSlug(vehicle, action, targetSlug)
         : this.getLoadedAmmoPieces(vehicle, action)
      const max = this.strikeMaxLoaded(action)
      const activeForSlug =
         active && (!targetSlug || slugify(active.slug) === targetSlug)
            ? active
            : pieces[0] || null
      const ammoName =
         activeForSlug?.name ||
         this.ammoTypeLabel(vehicle, targetSlug) ||
         tKey("Ammunition.TypeUnassigned")
      const chargesText = activeForSlug?.usesCharges
         ? `; ${tKey("Weaponry.ActiveCharges", {
              current: activeForSlug.charges,
              max: activeForSlug.max,
           })}`
         : ""
      return {
         slug: targetSlug,
         name: ammoName,
         loaded: pieces.length,
         max,
         active: activeForSlug,
         chargesText,
         display: `${pieces.length} / ${max} (${ammoName}${chargesText})`,
      }
   }

   static async setLoadedAmmoPieces(vehicle, actionId, pieces, activeId = null) {
      const clean = (pieces || [])
         .map((piece, index) => this._normalizeLoadedPiece(piece, index))
         .filter(Boolean)
      const nextActive = clean.some((piece) => piece.id === activeId)
         ? activeId
         : clean[0]?.id || null
      console.debug("[siege][ammo] setLoadedAmmoPieces", {
         vehicle: vehicle?.name,
         actionId,
         activeId: nextActive,
         pieces: clean.map((piece) => ({
            id: piece.id,
            charges: piece.charges,
            max: piece.max,
            name: piece.name,
         })),
      })
      await this._setMapFlagEntry(vehicle, "loadedAmmoPiecesByStrike", actionId, {
         activeId: nextActive,
         pieces: clean,
      })
      const chargedPieces = clean.filter((piece) => piece.usesCharges)
      await this.setStrikeLoadedCharges(
         vehicle,
         actionId,
         chargedPieces.length === clean.length
            ? chargedPieces.map((piece) => piece.charges)
            : [],
      )
      await this.setStrikeLoaded(vehicle, actionId, clean.length)
   }

   static async setActiveLoadedPiece(vehicle, action, pieceId) {
      const pieces = this.getLoadedAmmoPieces(vehicle, action)
      if (!pieces.some((piece) => piece.id === pieceId)) return false
      await this._setMapFlagEntry(
         vehicle,
         "loadedAmmoPiecesByStrike",
         action.id,
         { activeId: pieceId, pieces },
      )
      console.debug("[siege][ammo] active loaded piece changed", {
         vehicle: vehicle?.name,
         action: action?.name,
         pieceId,
      })
      return true
   }

   static getLoadedChargeTotal(vehicle, action) {
      if (!vehicle || !action) return 0
      const active = this.getActiveLoadedPiece(vehicle, action)
      if (active?.usesCharges) return Number(active.charges) || 0
      const stored = this.getStrikeLoadedCharges(vehicle, action)
      if (stored.length > 0)
         return stored.reduce((sum, value) => sum + (Number(value) || 0), 0)

      const loaded = this.getStrikeLoaded(vehicle, action)
      if (loaded <= 0) return 0
      const charge = this._chargeInfo(this.getLoadedAmmoTemplate(vehicle, action))
      return charge.usesCharges ? loaded * charge.max : 0
   }

   static reloadNeedsChargedReplacement(vehicle, action) {
      const active = this.getActiveLoadedPiece(vehicle, action)
      if (active?.usesCharges) return true
      return this.ammoSlugsForAction(action).some(
         (slug) =>
            this.ammoUsesCharges(vehicle, slug) &&
            this.getLoadedAmmoPieces(vehicle, action).length > 0,
      )
   }

   static weaponryAmmoDetail(vehicle, action, slug = null) {
      if (!vehicle || !action)
         return ""
      const active = this.getActiveLoadedPiece(vehicle, action)
      if (active?.usesCharges) {
         return active
            ? tKey("Weaponry.ActiveCharges", {
                 current: active.charges,
                 max: active.max,
              })
            : tKey("Weaponry.ActiveCharges", { current: 0, max: 0 })
      }
      const slugs = slug ? [slugify(slug)] : this.ammoSlugsForAction(action)
      const parts = slugs
         .filter((s) => this.ammoTypeFor(vehicle, s))
         .map((s) => {
            const prefix = slugs.length > 1 ? `${this.ammoTypeLabel(vehicle, s)}: ` : ""
            return `${prefix}${tKey("Weaponry.InReserve", {
               n: this.getAvailableUnits(vehicle, s),
            })}`
         })
      return parts.join("; ")
   }

   static _seedLoadedCharges(vehicle, action) {
      const stored = this.getStrikeLoadedCharges(vehicle, action)
      if (stored.length > 0) return stored
      const loaded = this.getStrikeLoaded(vehicle, action)
      const charge = this._chargeInfo(this.getLoadedAmmoTemplate(vehicle, action))
      if (!charge.usesCharges || loaded <= 0) return []
      return Array.from({ length: loaded }, () => charge.max)
   }

   static _pieceId() {
      return (
         foundry.utils.randomID?.(8) ||
         globalThis.crypto?.randomUUID?.() ||
         `${Date.now()}-${Math.random().toString(16).slice(2)}`
      )
   }

   static _slugFromTemplate(tpl) {
      return slugify(tpl?.system?.slug || tpl?.slug || tpl?.name || "")
   }

   static _pieceFromTemplate(tpl, charges, index = 0, slug = null) {
      const charge = this._chargeInfo(tpl)
      const usesCharges = charge.usesCharges
      const max = usesCharges
         ? charge.max || Math.max(1, Number(charges) || 1)
         : 1
      const value = Math.max(0, Math.min(max, Number(charges) || 0))
      if (value <= 0) return null
      return {
         id: `loaded-${index}-${this._pieceId()}`,
         slug: slugify(slug) || this._slugFromTemplate(tpl),
         name: tpl?.name || "Ammunition",
         img: tpl?.img || DEFAULT_AMMO_IMG,
         charges: value,
         max,
         usesCharges,
         chargeKey: charge.key || "uses",
         template: foundry.utils.deepClone(tpl || {}),
      }
   }

   static _normalizeLoadedPiece(piece, index = 0) {
      if (!piece) return null
      const template = foundry.utils.deepClone(piece.template || {})
      const charge = this._chargeInfo(template)
      const usesCharges = piece.usesCharges ?? charge.usesCharges
      const max =
         Number(piece.max) ||
         (usesCharges ? charge.max : 1) ||
         Math.max(1, Number(piece.charges) || 1)
      const charges = Math.max(0, Math.min(max, Number(piece.charges) || 0))
      if (charges <= 0) return null
      return {
         id: String(piece.id || `loaded-${index}-${this._pieceId()}`),
         slug: slugify(piece.slug) || this._slugFromTemplate(template),
         name: piece.name || template.name || "Ammunition",
         img: piece.img || template.img || DEFAULT_AMMO_IMG,
         charges,
         max,
         usesCharges,
         chargeKey: piece.chargeKey || charge.key || "uses",
         template,
      }
   }

   static async setStrikeLoadedCharges(vehicle, actionId, charges) {
      const clean = (charges || [])
         .map((n) => Math.max(0, Number(n) || 0))
         .filter((n) => n > 0)
      await this._setMapFlagEntry(
         vehicle,
         "loadedAmmoChargesByStrike",
         actionId,
         clean,
      )
   }

   static async setStrikeLoaded(vehicle, actionId, count) {
      await this._setMapFlagEntry(
         vehicle,
         "loadedByStrike",
         actionId,
         Math.max(0, Number(count) || 0),
      )

      if (count <= 0) await this.clearLoadedAmmoTemplate(vehicle, actionId)
      await this.syncStrikeLoadedEffects(vehicle)
      
      const after = vehicle.getFlag(MODULE_ID, "loadedByStrike") || {}
      console.debug(
         `[siege][ammo] setStrikeLoaded ${actionId} -> ${count}; stored now=${after[actionId] ?? 0}`,
      )
   }

   static async setLoadedAmmoTemplate(vehicle, actionId, tpl) {
      if (!vehicle || !actionId || !tpl) return
      await this._setMapFlagEntry(
         vehicle,
         "loadedAmmoTemplates",
         actionId,
         tpl,
      )
   }

   static async clearLoadedAmmoTemplate(vehicle, actionId) {
      if (!vehicle || !actionId) return
      await this._setMapFlagEntry(vehicle, "loadedAmmoTemplates", actionId, null)
   }

   static async _setMapFlagEntry(vehicle, flagKey, entryKey, value) {
      if (!vehicle || !flagKey || !entryKey) return
      const before = foundry.utils.deepClone(
         vehicle.getFlag(MODULE_ID, flagKey) || {},
      )
      const next = foundry.utils.deepClone(before)
      next[entryKey] = value
      console.debug("[siege][ammo] flag write", {
         vehicle: vehicle.name,
         flagKey,
         entryKey,
         before,
         value,
         next,
      })
      await vehicle.setFlag(MODULE_ID, flagKey, next)
      console.debug("[siege][ammo] flag stored", {
         vehicle: vehicle.name,
         flagKey,
         entryKey,
         storedMap: vehicle.getFlag(MODULE_ID, flagKey),
         stored: vehicle.getFlag(MODULE_ID, flagKey)?.[entryKey],
      })
   }

   static async _deleteMapFlagEntry(vehicle, flagKey, entryKey) {
      if (!vehicle || !flagKey || !entryKey) return
      const map = foundry.utils.deepClone(
         vehicle.getFlag(MODULE_ID, flagKey) || {},
      )
      if (!(entryKey in map)) return
      delete map[entryKey]
      if (Object.keys(map).length === 0) {
         await vehicle.unsetFlag(MODULE_ID, flagKey)
         return
      }

      const forcedDeletion = foundry.data?.operators?.ForcedDeletion
      if (forcedDeletion) {
         await vehicle.update({
            [`flags.${MODULE_ID}.${flagKey}`]: {
               [entryKey]: forcedDeletion,
            },
         })
      } else {
         await vehicle.update({
            [`flags.${MODULE_ID}.${flagKey}.-=${entryKey}`]: null,
         })
      }
   }

   static _templateFromItem(item) {
      if (!item) return null
      const tpl = item.toObject()
      delete tpl._id
      delete tpl.ownership
      tpl.system = tpl.system || {}
      tpl.system.quantity = 1
      const charge = this._chargeInfo(tpl)
      if (charge.usesCharges)
         this._setChargeValueOnData(tpl, charge.max, charge.key, charge.max)
      return tpl
   }

   static normalizeSiegeAmmoFlags(raw = {}) {
      return {
         damageParts:
            Array.isArray(raw.damageParts) && raw.damageParts.length
               ? raw.damageParts
               : [{ ...DEFAULT_AMMO_DAMAGE_PART }],
         modifyRange: raw.modifyRange === true,
         isRanged: raw.isRanged !== false,
         blindRange: raw.blindRange ?? "",
         minRange: raw.minRange ?? "",
         rangeIncrement: raw.rangeIncrement ?? "",
         maxRange: raw.maxRange ?? "",
         attackBonus: raw.attackBonus ?? 0,
         rollOptions: raw.rollOptions || "",
         rewriteRollOptions: raw.rewriteRollOptions === true,
         traits: raw.traits || "",
         rewriteTraits: raw.rewriteTraits === true,
         material: slugify(raw.material || ""),
         modifySaveDC: raw.modifySaveDC === true,
         saveDCPaths: Array.isArray(raw.saveDCPaths) ? raw.saveDCPaths : [],
         modifyArea: raw.modifyArea === true,
         areaSize: raw.areaSize ?? 5,
         areaType: raw.areaType || "burst",
      }
   }

   static siegeAmmoFlagsFromData(data = {}) {
      const raw =
         data?.flags?.[MODULE_ID]?.siegeAmmo ||
         data?.getFlag?.(MODULE_ID, "siegeAmmo") ||
         {}
      return this.normalizeSiegeAmmoFlags(raw)
   }

   static activeAmmoPayload(vehicle, action) {
      if (!vehicle || !action) return null
      const active = this.getActiveLoadedPiece(vehicle, action)
      const template = active?.template || this.getLoadedAmmoTemplate(vehicle, action)
      if (!template) return null
      return {
         piece: active,
         slug: active?.slug || this._slugFromTemplate(template),
         flags: this.siegeAmmoFlagsFromData(template),
         template,
      }
   }

   static _mergeCSV(base, extra, rewrite = false) {
      const extraParts = splitCSV(extra)
      if (rewrite) return extraParts.join(", ")
      const values = splitCSV(base)
      for (const value of extraParts) {
         if (!values.includes(value)) values.push(value)
      }
      return values.join(", ")
   }

   static applyAmmoOverridesToFlag(flag, payload) {
      const effective = foundry.utils.deepClone(flag || {})
      if (effective.usesAmmunition === false || !payload?.flags) return effective
      const ammo = payload.flags
      if (Array.isArray(ammo.damageParts) && ammo.damageParts.length)
         effective.damageParts = foundry.utils.deepClone(ammo.damageParts)
      if (ammo.modifyRange) {
         effective.isRanged = ammo.isRanged
         effective.blindRange = ammo.blindRange
         effective.minRange = ammo.minRange
         effective.rangeIncrement = ammo.rangeIncrement
         effective.maxRange = ammo.maxRange
      }
      const attackBonus = parseInt(ammo.attackBonus) || 0
      if (attackBonus !== 0)
         effective.attackBonus = (parseInt(effective.attackBonus) || 0) + attackBonus
      if (ammo.rollOptions || ammo.rewriteRollOptions)
         effective.rollOptions = this._mergeCSV(
            effective.rollOptions,
            ammo.rollOptions,
            ammo.rewriteRollOptions,
         )
      if (ammo.traits || ammo.rewriteTraits)
         effective.traits = this._mergeCSV(
            effective.traits,
            ammo.traits,
            ammo.rewriteTraits,
         )
      if (ammo.material) effective.material = slugify(ammo.material)
      if (ammo.modifySaveDC)
         effective.saveDCPaths = foundry.utils.deepClone(ammo.saveDCPaths || [])
      if (ammo.modifyArea) {
         effective.areaSize = ammo.areaSize
         effective.areaType = ammo.areaType
      }
      effective.loadedAmmoSlug = payload.slug || ""
      effective.loadedAmmoName = payload.piece?.name || payload.template?.name || ""
      return effective
   }

   
   
   static async syncStrikeLoadedEffects(vehicle) {
      if (!vehicle) return
      const map = vehicle.getFlag(MODULE_ID, "loadedByStrike") || {}
      const actions = vehicle.items.filter((i) => i.type === "action")
      
      const wantNames = new Set()
      for (const a of actions) {
         const n = Number(map[a.id]) || 0
         if (n > 0)
            wantNames.add(tKey("Markers.LoadedStrikePrefix", { name: a.name }))
      }
      const stale = vehicle.itemTypes.effect.filter(
         (e) =>
            e.getFlag(MODULE_ID, "isStrikeLoadedMarker") &&
            !wantNames.has(e.name),
      )
      if (stale.length)
         await vehicle.deleteEmbeddedDocuments(
            "Item",
            stale.map((e) => e.id),
            { siegeAmmoSync: true },
         )
      
      for (const a of actions) {
         const n = Number(map[a.id]) || 0
         const effectName = tKey("Markers.LoadedStrikePrefix", { name: a.name })
         const existing = vehicle.itemTypes.effect.find(
            (e) =>
               e.name === effectName &&
               e.getFlag(MODULE_ID, "isStrikeLoadedMarker"),
         )
            if (n > 0) {
            if (existing) {
               if (existing.system.badge?.value !== n)
                  await existing.update(
                     { "system.badge.value": n },
                     { siegeAmmoSync: true },
                  )
            } else {
               await vehicle.createEmbeddedDocuments("Item", [
                  {
                     name: effectName,
                     type: "effect",
                     img: a.img || DEFAULT_AMMO_IMG,
                     system: {
                        badge: { type: "counter", value: n },
                        tokenIcon: { show: true },
                     },
                     flags: { [MODULE_ID]: { isStrikeLoadedMarker: true } },
                  },
               ])
            }
         } else if (existing) {
            await existing.delete({ siegeAmmoSync: true })
         }
      }
   }

   
   
   
   static async promptAmmoTypeChoice(
      vehicle,
      action,
      purpose = "reload",
      sourceOptions = {},
   ) {
      const choices = this.ammoTypesForAction(vehicle, action)
      if (choices.length === 0) {
         ui.notifications.warn(tKey("Notifications.UnassignedAmmo"))
         return null
      }
      if (choices.length === 1) return choices[0].slug

      const activeSlug = this.activeAmmoSlug(vehicle, action)
      const sources = await this.collectLoadSources(
         vehicle,
         sourceOptions.crewmanUuid || sourceOptions.crewman,
         { includeAdjacent: sourceOptions.useAdjacent !== false },
      )
      const escape = (s) =>
         foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "")
      const optionMarkup = choices
         .map(({ slug, type }) => {
            const available = this.getAvailableLoadUnitsFromSources(
               vehicle,
               slug,
               sources,
            )
            const disabled = purpose === "reload" && available <= 0 ? "disabled" : ""
            const active = slug === activeSlug ? ` ${tKey("Weaponry.ActiveMarker")}` : ""
            return `<option value="${slug}" ${disabled}>${escape(type.name)} (${tKey("Weaponry.InReserve", { n: available })})${active}</option>`
         })
         .join("")
      if (
         !optionMarkup ||
         !choices.some(
            ({ slug }) =>
               this.getAvailableLoadUnitsFromSources(vehicle, slug, sources) > 0,
         )
      ) {
         ui.notifications.warn(tKey("Notifications.InsufficientAmmo"))
         return null
      }

      const result = await foundry.applications.api.DialogV2.wait({
         classes: ["siege-v2-dialog"],
         window: { title: tKey("Weaponry.SelectAmmoTypeTitle") },
         content: `<div class="form-group stacked">
            <label>${tKey("Load.Ammunition")}</label>
            <select class="siege-ammo-type-choice">${optionMarkup}</select>
         </div>`,
         buttons: [
            {
               action: "ok",
               label: tKey("Buttons.Confirm"),
               default: true,
               callback: (event, button, dialog) =>
                  (dialog?.element ?? document).querySelector(
                     ".siege-ammo-type-choice",
                  )?.value || null,
            },
            { action: "cancel", label: tKey("CrewHUD.Cancel") },
         ],
      }).catch(() => null)
      return result ? slugify(result) : null
   }

   static async reloadStrike(vehicle, action, amount = null, options = {}) {
      const flag = action?.getFlag?.(MODULE_ID, "siegeAction") || {}
      if (flag.usesAmmunition === false) {
         ui.notifications.warn(tKey("Notifications.UnassignedAmmo"))
         return false
      }
      const supportedSlugs = this.ammoSlugsForAction(flag)
      let slug = slugify(options.slug || options.ammoSlug || "")
      if (!slug || !supportedSlugs.includes(slug)) {
         if (supportedSlugs.length === 0) {
            ui.notifications.warn(tKey("Notifications.UnassignedAmmo"))
            return false
         }
         if (supportedSlugs.length === 1) slug = supportedSlugs[0]
         else {
            slug = await this.promptAmmoTypeChoice(
               vehicle,
               action,
               "reload",
               options,
            )
            if (!slug) return false
         }
      }
      if (!slug || !this.ammoTypeFor(vehicle, slug)) {
         ui.notifications.warn(tKey("Notifications.UnassignedAmmo"))
         return false
      }
      const max = this.strikeMaxLoaded(action)
      let pieces = this.getLoadedAmmoPieces(vehicle, action)
      let current = Math.max(this.getStrikeLoaded(vehicle, action), pieces.length)
      if (
         !(await this._ensureSingleLoadedAmmoType(vehicle, action, slug, pieces, {
            confirmedReplace: options.replaceLoadedAmmoType === true,
         }))
      )
         return false
      pieces = this.getLoadedAmmoPieces(vehicle, action)
      current = Math.max(this.getStrikeLoaded(vehicle, action), pieces.length)
      const sources = await this.collectLoadSources(
         vehicle,
         options.crewmanUuid || options.crewman,
         { includeAdjacent: options.useAdjacent !== false },
      )
      const chargeBased =
         this.ammoUsesCharges(vehicle, slug) ||
         this.ammoUsesChargesFromSources(vehicle, slug, sources)

      if (chargeBased)
         return this._reloadChargedStrike(
            vehicle,
            action,
            slug,
            max,
            amount,
            { ...options, sources },
         )

      let need = Math.max(0, max - current)
      if (amount != null) need = Math.min(need, Math.max(0, parseInt(amount) || 0))
      if (need <= 0) {
         ui.notifications.info(tKey("Weaponry.AlreadyFull"))
         return false
      }

      const available = this.getAvailableLoadUnitsFromSources(
         vehicle,
         slug,
         sources,
      )
      const toLoad = Math.min(need, available)
      if (toLoad <= 0) {
         ui.notifications.warn(tKey("Notifications.InsufficientAmmo"))
         return false
      }

      const extracted = await this._consumeNonChargedLoadUnitsFromSources(
         vehicle,
         slug,
         toLoad,
         sources,
      )
      if (!extracted.ok) return false
      const tpl = extracted.template
      const newPieces = Array.from({ length: toLoad }, (_v, index) =>
         this._pieceFromTemplate(tpl, 1, pieces.length + index, slug),
      ).filter(Boolean)
      const nextPieces = [...pieces, ...newPieces]
      await this.setLoadedAmmoPieces(
         vehicle,
         action.id,
         nextPieces,
         this.getActiveLoadedPieceId(vehicle, action) || newPieces[0]?.id,
      )
      if (tpl) await this.setLoadedAmmoTemplate(vehicle, action.id, tpl)
      console.debug(
         `[siege][ammo] reloaded ${action.name} +${toLoad} -> ${current + toLoad}/${max}`,
      )
      SiegeSFXManager.play(vehicle, `load-${slug}`, options.sourceUserId)
      ui.notifications.info(
         tKey("Weaponry.Reloaded", { name: action.name, n: current + toLoad }),
      )
      return true
   }

   static async promptChargedReplacement(vehicle, action, slug = null) {
      const flag = action?.getFlag?.(MODULE_ID, "siegeAction") || {}
      const targetSlug = slugify(
         slug || this.primaryAmmoSlugForAction(flag) || "",
      )
      const choices = this._ammoItemsFor(vehicle, targetSlug).filter((item) => {
         const charge = this._chargeInfo(item)
         return charge.usesCharges && (Number(item.system?.quantity) || 1) > 0
      })
      if (choices.length === 0) {
         ui.notifications.warn(tKey("Notifications.InsufficientAmmo"))
         return null
      }

      const escape = (s) =>
         foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "")
      const options = choices
         .map((item) => {
            const charge = this._chargeInfo(item)
            const qty = Number(item.system?.quantity) || 1
            const qtyText = qty > 1 ? `, x${qty}` : ""
            return `<option value="${item.id}">${escape(item.name)} (${charge.value}/${charge.max}${qtyText})</option>`
         })
         .join("")
      const loadedCharges = this.getLoadedChargeTotal(vehicle, action)
      const result = await foundry.applications.api.DialogV2.wait({
         classes: ["siege-v2-dialog"],
         window: { title: tKey("Weaponry.ReplaceTitle") },
         position: { width: 430 },
         content: `<div class="form-group stacked">
            <p class="notes">${tKey("Weaponry.ReplacePrompt", {
               name: action.name,
               charges: loadedCharges,
            })}</p>
            <label>${tKey("Load.Ammunition")}</label>
            <select class="siege-replace-ammo">${options}</select>
         </div>`,
         buttons: [
            {
               action: "replace",
               label: tKey("Weaponry.Replace"),
               icon: "fa-solid fa-rotate",
               default: true,
               callback: (event, button, dialog) => {
                  const root = dialog?.element ?? document
                  return {
                     itemId: root.querySelector(".siege-replace-ammo")?.value,
                  }
               },
            },
            {
               action: "cancel",
               label: tKey("CrewHUD.Cancel"),
               callback: () => null,
            },
         ],
      }).catch(() => null)
      return result?.itemId ? result : null
   }

   static async _reloadChargedStrike(
      vehicle,
      action,
      slug,
      max,
      amount = null,
      options = {},
   ) {
      let pieces = this.getLoadedAmmoPieces(vehicle, action)
      const activeId = this.getActiveLoadedPieceId(vehicle, action)
      const room = Math.max(0, max - pieces.length)
      const sources =
         options.sources ||
         (await this.collectLoadSources(
            vehicle,
            options.crewmanUuid || options.crewman,
            { includeAdjacent: options.useAdjacent !== false },
         ))
      const available = this.getAvailableLoadUnitsFromSources(
         vehicle,
         slug,
         sources,
      )
      let choice = options?.mode
         ? options
         : pieces.length > 0
            ? await this.promptChargedReloadChoice(vehicle, action, slug, {
                 ...options,
                 available,
              })
            : { mode: "loadMore" }
      if (!choice) return false

      console.debug("[siege][ammo] charged reload choice", {
         vehicle: vehicle.name,
         action: action.name,
         choice,
         max,
         loadedPieces: pieces.map((piece) => ({
            id: piece.id,
            charges: piece.charges,
            max: piece.max,
            active: piece.id === activeId,
         })),
         room,
         available,
         sources: sources.map((source) => source?.name),
      })

      if (choice.mode === "replace") {
         const pieceId = choice.pieceId || activeId
         const replaceIndex = pieces.findIndex((piece) => piece.id === pieceId)
         if (replaceIndex < 0) {
            ui.notifications.warn(tKey("Weaponry.NoLoadedPiece"))
            return false
         }
         const itemId = choice.itemId || choice.replaceItemId
         if (!itemId) return false
         const oldPiece = pieces[replaceIndex]
         const extracted = await this._extractLoadedUnits(vehicle, slug, 1, itemId)
         if (!extracted.ok || extracted.pieces.length === 0) {
            ui.notifications.warn(tKey("Notifications.InsufficientAmmo"))
            return false
         }
         if (oldPiece.usesCharges)
            await this._addChargedPieces(vehicle, oldPiece.slug || slug, [oldPiece])
         else await this._addUnits(vehicle, oldPiece.slug || slug, 1, oldPiece.template)
         const newPiece = extracted.pieces[0]
         pieces[replaceIndex] = newPiece
         await this.setLoadedAmmoPieces(vehicle, action.id, pieces, newPiece.id)
         await this.setLoadedAmmoTemplate(vehicle, action.id, newPiece.template)
         SiegeSFXManager.play(vehicle, `load-${slug}`, options.sourceUserId)
         ui.notifications.info(
            tKey("Weaponry.ReplacedLoadedAmmo", { name: action.name }),
         )
         return true
      }

      const toLoad = Math.min(room, available)
      if (toLoad <= 0) {
         ui.notifications.warn(tKey("Notifications.InsufficientAmmo"))
         return false
      }
      const extracted = await this._extractChargedLoadUnitsFromSources(
         vehicle,
         slug,
         toLoad,
         sources,
      )
      if (!extracted.ok || extracted.pieces.length === 0) {
         ui.notifications.warn(tKey("Notifications.InsufficientAmmo"))
         return false
      }
      pieces.push(...extracted.pieces)
      const nextActive = activeId || extracted.pieces[0]?.id || null
      await this.setLoadedAmmoPieces(vehicle, action.id, pieces, nextActive)
      await this.setLoadedAmmoTemplate(
         vehicle,
         action.id,
         extracted.pieces[0]?.template || extracted.template,
      )
      SiegeSFXManager.play(vehicle, `load-${slug}`, options.sourceUserId)
      ui.notifications.info(
         tKey("Weaponry.Reloaded", { name: action.name, n: pieces.length }),
      )
      return true
   }

   static async promptChargedReloadChoice(
      vehicle,
      action,
      slug = null,
      options = {},
   ) {
      const flag = action?.getFlag?.(MODULE_ID, "siegeAction") || {}
      const targetSlug = slugify(
         slug || this.primaryAmmoSlugForAction(flag) || "",
      )
      const pieces = this.getLoadedAmmoPieces(vehicle, action)
      const activeId = this.getActiveLoadedPieceId(vehicle, action)
      const max = this.strikeMaxLoaded(action)
      const room = Math.max(0, max - pieces.length)
      let available = options.available
      if (available == null) {
         const sources = await this.collectLoadSources(
            vehicle,
            options.crewmanUuid || options.crewman,
            { includeAdjacent: options.useAdjacent !== false },
         )
         available = this.getAvailableLoadUnitsFromSources(
            vehicle,
            targetSlug,
            sources,
         )
      }
      const stash = this._ammoItemsFor(vehicle, targetSlug).filter((item) => {
         const charge = this._chargeInfo(item)
         return charge.usesCharges && (Number(item.system?.quantity) || 1) > 0
      })
      const escape = (s) =>
         foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "")
      const pieceOptions = [
         room > 0 && available > 0
            ? `<option value="loadMore">${tKey("Weaponry.LoadMoreCharged", {
                 n: Math.min(room, available),
              })}</option>`
            : "",
         ...pieces.map(
            (piece) =>
               `<option value="${piece.id}">${escape(piece.name)}${piece.usesCharges ? ` ${piece.charges}/${piece.max}` : ""}${piece.id === activeId ? ` ${tKey("Weaponry.ActiveMarker")}` : ""}</option>`,
         ),
      ].join("")
      const stashOptions = stash
         .map((item) => {
            const charge = this._chargeInfo(item)
            const qty = Number(item.system?.quantity) || 1
            const qtyText = qty > 1 ? `, x${qty}` : ""
            return `<option value="${item.id}">${escape(item.name)} (${charge.value}/${charge.max}${qtyText})</option>`
         })
         .join("")
      const result = await foundry.applications.api.DialogV2.wait({
         classes: ["siege-v2-dialog"],
         window: { title: tKey("Weaponry.ChargedReloadTitle") },
         position: { width: 470 },
         content: `<div class="form-group stacked">
            <p class="notes">${tKey("Weaponry.ChargedReloadPrompt", {
               name: action.name,
            })}</p>
            <label>${tKey("Weaponry.LoadedPiece")}</label>
            <select class="siege-charged-choice">${pieceOptions}</select>
            <label>${tKey("Weaponry.ReplacementFromStash")}</label>
            <select class="siege-charged-stash">${stashOptions}</select>
         </div>`,
         buttons: [
            {
               action: "ok",
               label: tKey("Weaponry.Reload"),
               default: true,
               callback: (event, button, dialog) => {
                  const root = dialog?.element ?? document
                  const selected =
                     root.querySelector(".siege-charged-choice")?.value ||
                     "loadMore"
                  if (selected === "loadMore") return { mode: "loadMore" }
                  return {
                     mode: "replace",
                     pieceId: selected,
                     itemId: root.querySelector(".siege-charged-stash")?.value,
                  }
               },
            },
            {
               action: "cancel",
               label: tKey("CrewHUD.Cancel"),
               callback: () => null,
            },
         ],
      }).catch(() => null)
      if (result?.mode === "replace") {
         if (!result.itemId) {
            ui.notifications.warn(tKey("Notifications.InsufficientAmmo"))
            return null
         }
         const confirmed = await foundry.applications.api.DialogV2.confirm({
            classes: ["siege-v2-dialog"],
            window: { title: tKey("Weaponry.ReplaceTitle") },
            content: `<p>${tKey("Weaponry.ReplaceLoadedPieceConfirm")}</p>`,
            rejectClose: false,
         }).catch(() => false)
         if (!confirmed) return null
      }
      return result
   }

   static _switchableAmmoSlugs(vehicle, action) {
      const currentSlug = slugify(
         this.getActiveLoadedPiece(vehicle, action)?.slug ||
            this.activeAmmoSlug(vehicle, action),
      )
      return this.ammoSlugsForAction(action)
         .filter((slug) => slug && slug !== currentSlug)
         .filter((slug) => this.ammoTypeFor(vehicle, slug))
         .filter((slug) => this.getAvailableLoadUnits(vehicle, slug) > 0)
   }

   static async switchActiveLoadedAmmo(vehicle, action, choice = null) {
      const selected = choice || (await this.promptSwitchLoadedAmmoChoice(vehicle, action))
      if (!selected) return false
      if (typeof selected === "string")
         return this.setActiveLoadedPiece(vehicle, action, selected)
      if (selected.pieceId) return this.setActiveLoadedPiece(vehicle, action, selected.pieceId)
      if (selected.ammoSlug)
         return this.replaceLoadedAmmoType(vehicle, action, selected.ammoSlug)
      return false
   }

   static async replaceLoadedAmmoType(vehicle, action, ammoSlug) {
      const slug = slugify(ammoSlug)
      const supportedSlugs = this.ammoSlugsForAction(action)
      if (!slug || !supportedSlugs.includes(slug) || !this.ammoTypeFor(vehicle, slug)) {
         ui.notifications.warn(tKey("Notifications.UnassignedAmmo"))
         return false
      }
      if (this.getAvailableLoadUnits(vehicle, slug) <= 0) {
         ui.notifications.warn(tKey("Notifications.InsufficientAmmo"))
         return false
      }
      const pieces = this.getLoadedAmmoPieces(vehicle, action)
      if (pieces.length === 0 && this.getStrikeLoaded(vehicle, action) <= 0) {
         ui.notifications.info(tKey("Weaponry.NothingLoaded"))
         return false
      }
      return this.reloadStrike(vehicle, action, 1, {
         slug,
         replaceLoadedAmmoType: true,
         useAdjacent: false,
      })
   }

   static canSwitchLoadedAmmo(vehicle, action) {
      const pieces = this.getLoadedAmmoPieces(vehicle, action)
      const current = Math.max(this.getStrikeLoaded(vehicle, action), pieces.length)
      if (current <= 0 || pieces.length === 0) return false
      const loadedSlugs = new Set(pieces.map((piece) => slugify(piece.slug || piece.name)))
      if (pieces.length > 1 && (pieces.some((piece) => piece.usesCharges) || loadedSlugs.size > 1))
         return true
      return this._switchableAmmoSlugs(vehicle, action).length > 0
   }

   static async promptSwitchLoadedAmmoChoice(vehicle, action) {
      const pieces = this.getLoadedAmmoPieces(vehicle, action)
      if (!this.canSwitchLoadedAmmo(vehicle, action)) {
         ui.notifications.info(tKey("Weaponry.NoAlternateLoadedAmmo"))
         return null
      }
      const activeId = this.getActiveLoadedPieceId(vehicle, action)
      const escape = (s) =>
         foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "")
      const loadedSlugs = new Set(pieces.map((piece) => slugify(piece.slug || piece.name)))
      const loadedOptions =
         pieces.length > 1 && (pieces.some((piece) => piece.usesCharges) || loadedSlugs.size > 1)
            ? pieces
                 .map(
                    (piece) =>
                       `<option value="piece:${escape(piece.id)}" ${piece.id === activeId ? "selected" : ""}>${escape(piece.name)}${piece.usesCharges ? ` ${piece.charges}/${piece.max}` : ""}${piece.id === activeId ? ` ${tKey("Weaponry.ActiveMarker")}` : ""}</option>`,
                 )
                 .join("")
            : ""
      const replacementOptions = this._switchableAmmoSlugs(vehicle, action)
         .map(
            (slug) =>
               `<option value="slug:${escape(slug)}">${escape(this.ammoTypeLabel(vehicle, slug) || slug)} (${tKey("Weaponry.InReserve", { n: this.getAvailableLoadUnits(vehicle, slug) })})</option>`,
         )
         .join("")
      const result = await foundry.applications.api.DialogV2.wait({
         classes: ["siege-v2-dialog"],
         window: { title: tKey("Weaponry.SwitchLoadedTitle") },
         content: `<div class="form-group stacked">
            <label>${tKey("Weaponry.SwitchTo")}</label>
            <select class="siege-switch-loaded">${loadedOptions}${replacementOptions}</select>
         </div>`,
         buttons: [
            {
               action: "ok",
               label: tKey("Weaponry.SwitchLoaded"),
               default: true,
               callback: (event, button, dialog) => ({
                  value:
                     (dialog?.element ?? document).querySelector(".siege-switch-loaded")?.value ||
                     null,
               }),
            },
            { action: "cancel", label: tKey("CrewHUD.Cancel") },
         ],
      }).catch(() => null)
      const value = result?.value || null
      if (!value) return null
      if (value.startsWith("piece:")) return { pieceId: value.slice(6) }
      if (value.startsWith("slug:")) return { ammoSlug: value.slice(5) }
      return { pieceId: value }
   }

   static async promptChargedUnloadChoice(vehicle, action, pieces = null) {
      const loadedPieces = pieces || this.getLoadedAmmoPieces(vehicle, action)
      if (loadedPieces.length <= 1) return loadedPieces.map((piece) => piece.id)
      const activeId = this.getActiveLoadedPieceId(vehicle, action)
      const escape = (s) =>
         foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "")
      const rows = loadedPieces
         .map(
            (piece) => `<label class="siege-charged-unload-piece">
               <input type="checkbox" class="siege-charged-unload-cb" value="${escape(piece.id)}" checked>
               <span>${escape(piece.name)}${piece.usesCharges ? ` ${piece.charges}/${piece.max}` : ""}${piece.id === activeId ? ` ${tKey("Weaponry.ActiveMarker")}` : ""}</span>
            </label>`,
         )
         .join("")
      const result = await foundry.applications.api.DialogV2.wait({
         classes: ["siege-v2-dialog"],
         window: { title: tKey("Weaponry.ChargedUnloadTitle") },
         position: { width: 430 },
         content: `<div class="form-group stacked">
            <p class="notes">${tKey("Weaponry.ChargedUnloadPrompt", {
               name: action.name,
            })}</p>
            <div class="siege-charged-unload-list">${rows}</div>
         </div>`,
         buttons: [
            {
               action: "unload",
               label: tKey("Weaponry.Unload"),
               icon: "fa-solid fa-arrow-down",
               default: true,
               callback: (event, button, dialog) => {
                  const root = dialog?.element ?? document
                  return [
                     ...root.querySelectorAll(".siege-charged-unload-cb:checked"),
                  ].map((el) => el.value)
               },
            },
            {
               action: "cancel",
               label: tKey("CrewHUD.Cancel"),
               callback: () => null,
            },
         ],
      }).catch(() => null)
      return Array.isArray(result) ? result : null
   }

   
   static async unloadStrike(vehicle, action, amount = null, options = {}) {
      const slug = this.activeAmmoSlug(vehicle, action)
      const current = this.getStrikeLoaded(vehicle, action)
      console.debug(
         `[siege][ammo] unloadStrike: ${action?.name} slug=${slug} current=${current} amount=${amount}`,
      )
      if (current <= 0) {
         ui.notifications.info(tKey("Weaponry.NothingLoaded"))
         return false
      }
      let n = current
      if (amount != null) n = Math.min(current, Math.max(0, parseInt(amount) || 0))
      if (n <= 0) return false

      
      const templates = vehicle.getFlag(MODULE_ID, "loadedAmmoTemplates") || {}
      const tpl = templates[action.id]
      const tplCharge = this._chargeInfo(tpl)
      const loadedCharges = this.getStrikeLoadedCharges(vehicle, action)
      const loadedPieces = this.getLoadedAmmoPieces(vehicle, action)
      if (tplCharge.usesCharges || loadedCharges.length > 0 || loadedPieces.length > 0) {
         const seeded =
            loadedPieces.length > 0
               ? loadedPieces
               : (loadedCharges.length > 0
                    ? loadedCharges
                    : Array.from({ length: current }, () => tplCharge.max)
                 )
                    .map((value, index) =>
                       this._pieceFromTemplate(tpl, value, index, slug),
                    )
                    .filter(Boolean)
         let selectedIds = Array.isArray(options.pieceIds)
            ? options.pieceIds.map(String)
            : null
         if (!selectedIds && amount == null && seeded.length > 1) {
            selectedIds = await this.promptChargedUnloadChoice(vehicle, action, seeded)
            if (!selectedIds) return false
         }
         const selected = selectedIds
            ? new Set(selectedIds)
            : new Set(seeded.slice(0, n).map((piece) => piece.id))
         const returned = seeded.filter((piece) => selected.has(piece.id))
         const remaining = seeded.filter((piece) => !selected.has(piece.id))
         if (returned.length === 0) return false
         n = returned.length
         const activeId = this.getActiveLoadedPieceId(vehicle, action)
         const nextActive = remaining.some((piece) => piece.id === activeId)
            ? activeId
            : remaining[0]?.id || null
         await this.setLoadedAmmoPieces(
            vehicle,
            action.id,
            remaining,
            nextActive,
         )
         const storedNow = this.getStrikeLoaded(vehicle, action)
         console.debug("[siege][ammo] unload charged state after clear", {
            action: action.name,
            requested: n,
            returned: returned.map((piece) => ({
               id: piece.id,
               charges: piece.charges,
               max: piece.max,
            })),
            remaining: remaining.map((piece) => ({
               id: piece.id,
               charges: piece.charges,
               max: piece.max,
            })),
            storedNow,
         })
         if (storedNow !== remaining.length) {
            ui.notifications.warn(tKey("Weaponry.UnloadFailed"))
            return false
         }
         for (const piece of returned) {
            if (piece.usesCharges)
               await this._addChargedPieces(vehicle, piece.slug || slug, [piece])
            else await this._addUnits(vehicle, piece.slug || slug, 1, piece.template)
         }
      } else {
         const remaining = current - n
         await this.setStrikeLoaded(vehicle, action.id, remaining)
         const storedNow = this.getStrikeLoaded(vehicle, action)
         console.debug("[siege][ammo] unload non-charge state after clear", {
            action: action.name,
            requested: n,
            remaining,
            storedNow,
         })
         if (storedNow !== remaining) {
            ui.notifications.warn(tKey("Weaponry.UnloadFailed"))
            return false
         }
         await this._addUnits(vehicle, slug, n, tpl)
      }
      console.debug(
         `[siege][ammo] unloaded ${action.name} -${n} -> ${current - n}`,
      )
      ui.notifications.info(
         tKey("Weaponry.Unloaded", { name: action.name, n }),
      )
      return true
   }

   
   
   
   
   
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
      console.debug("[siege][ammo] returning charged pieces to stash", {
         actor: actor?.name,
         slug,
         pieces: clean.map((piece) => ({
            id: piece.id,
            charges: piece.charges,
            max: piece.max,
            name: piece.name,
         })),
      })
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
      console.debug("[siege][ammo] extracted charged units", {
         actor: actor?.name,
         slug,
         requested: units,
         preferredItemId,
         ok: remaining <= 0,
         charges,
         pieces: pieces.map((piece) => ({
            id: piece.id,
            charges: piece.charges,
            max: piece.max,
         })),
      })
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
      console.debug("[siege][ammo] extracted non-charged load units", {
         vehicle: vehicle?.name,
         slug,
         requested: units,
         ok: remaining <= 0,
         sources: sources.map((source) => source?.name),
      })
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
      console.debug("[siege][ammo] extracted charged load units from sources", {
         vehicle: vehicle?.name,
         slug,
         requested: units,
         ok: remaining <= 0,
         sources: sources.map((source) => source?.name),
         pieces: pieces.map((piece) => ({
            name: piece.name,
            charges: piece.charges,
            max: piece.max,
         })),
      })
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
   }
}
