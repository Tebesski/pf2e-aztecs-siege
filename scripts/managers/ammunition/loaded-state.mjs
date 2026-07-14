import { MODULE_ID, DEFAULT_AMMO_IMG, PHYSICAL_ITEM_TYPES } from "../../constants.mjs"
import { slugify, splitCSV, tKey } from "../../utils.mjs"
import { SiegeSFXManager } from "../sfx.mjs"
import { AMMO_LOAD_SOURCE_PRIORITY } from "./helpers.mjs"

class AmmunitionLoadedStateMixin {
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
      await vehicle.setFlag(MODULE_ID, flagKey, next)
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
         damageInfluence: raw.damageInfluence === "rewrite" ? "rewrite" : "modify",
         damageParts: Array.isArray(raw.damageParts) ? raw.damageParts : [],
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
      if (Array.isArray(ammo.damageParts) && ammo.damageParts.length) {
         if (ammo.damageInfluence === "rewrite")
            effective.damageParts = foundry.utils.deepClone(ammo.damageParts)
         else {
            effective.damageParts = Array.isArray(effective.damageParts)
               ? foundry.utils.deepClone(effective.damageParts)
               : []
            effective.damageParts.push(...foundry.utils.deepClone(ammo.damageParts))
         }
      }
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
         if (n > 0) wantNames.add(this._loadedStrikeMarkerData(vehicle, a).name)
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
         const marker = this._loadedStrikeMarkerData(vehicle, a)
         const effectName = marker.name
         const existing = vehicle.itemTypes.effect.find(
            (e) =>
               e.name === effectName &&
               e.getFlag(MODULE_ID, "isStrikeLoadedMarker"),
         )
         if (n > 0) {
            if (existing) {
               const update = {}
               if (existing.system.badge?.value !== n)
                  update["system.badge.value"] = n
               if (existing.img !== marker.img) update.img = marker.img
               if (existing.getFlag(MODULE_ID, "actionId") !== a.id)
                  update[`flags.${MODULE_ID}.actionId`] = a.id
               if (existing.getFlag(MODULE_ID, "ammoSlug") !== marker.ammoSlug)
                  update[`flags.${MODULE_ID}.ammoSlug`] = marker.ammoSlug
               if (existing.getFlag(MODULE_ID, "ammoName") !== marker.ammoName)
                  update[`flags.${MODULE_ID}.ammoName`] = marker.ammoName
               if (Object.keys(update).length)
                  await existing.update(update, { siegeAmmoSync: true })
            } else {
               await vehicle.createEmbeddedDocuments("Item", [
                  {
                     name: effectName,
                     type: "effect",
                     img: marker.img,
                     system: {
                        badge: { type: "counter", value: n },
                        tokenIcon: { show: true },
                     },
                     flags: {
                        [MODULE_ID]: {
                           isStrikeLoadedMarker: true,
                           actionId: a.id,
                           ammoSlug: marker.ammoSlug,
                           ammoName: marker.ammoName,
                        },
                     },
                  },
               ])
            }
         } else if (existing) {
            await existing.delete({ siegeAmmoSync: true })
         }
      }
   }

   static _loadedStrikeMarkerData(vehicle, action) {
      const active = this.getActiveLoadedPiece(vehicle, action)
      const slug = slugify(active?.slug || this.activeAmmoSlug(vehicle, action))
      const type = this.ammoTypeFor(vehicle, slug)
      const template = this.getLoadedAmmoTemplate(vehicle, action)
      const ammoName =
         type?.name ||
         this.ammoTypeLabel(vehicle, slug) ||
         active?.name ||
         template?.name ||
         ""
      const img =
         type?.img ||
         active?.img ||
         active?.template?.img ||
         template?.img ||
         DEFAULT_AMMO_IMG
      return {
         name: ammoName
            ? tKey("Markers.LoadedStrikeWithAmmo", {
                 name: action.name,
                 ammo: ammoName,
              })
            : tKey("Markers.LoadedStrikePrefix", { name: action.name }),
         img,
         ammoSlug: slug,
         ammoName,
      }
   }

}

export const ammunitionLoadedStateMethods = Object.fromEntries(
   Object.getOwnPropertyNames(AmmunitionLoadedStateMixin)
      .filter((name) => !["length", "name", "prototype"].includes(name))
      .map((name) => [name, AmmunitionLoadedStateMixin[name]]),
)
