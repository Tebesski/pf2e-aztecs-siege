import { MODULE_ID, rankIconPath } from "../constants.mjs"
import {
   slugify,
   tKey,
   validImg,
   portraitImgStyle,
   portraitBackgroundImgStyle,
   normalizePortraitData,
   getCostGlyph,
} from "../utils.mjs"
import { actionDisabledReason, ensureSiegeCSS } from "../macros/helpers.mjs"
import { actionDetailHTML } from "./crew-dossier.mjs"
import { ammoTypesAccordionHTML } from "./ammo-details.mjs"
import { AmmunitionManager } from "../managers/ammunition.mjs"
import { VehicleLoadManager } from "../managers/vehicle-load.mjs"
import { VehicleShieldManager } from "../managers/shields.mjs"
import { SiegeCrewManager } from "../managers/crew.mjs"
import { VehicleEntryManager } from "../managers/entry.mjs"
import { escapeHTML } from "./vehicle-hud/helpers.mjs"
import { vehicleHudModuleRenderMethods } from "./vehicle-hud/module-render.mjs"
import { vehicleHudModuleMethods } from "./vehicle-hud/modules.mjs"
import { vehicleHudRenderListenerMethods } from "./vehicle-hud/render-listeners.mjs"
import { vehicleHudStashMethods } from "./vehicle-hud/stash.mjs"

export class VehicleHUD extends foundry.applications.api.ApplicationV2 {
   static DEFAULT_OPTIONS = {
      id: "siege-vehicle-hud",
      classes: ["siege-vehicle-hud-app"],
      window: { title: "Vehicle", frame: true, positioned: true },
      position: { width: 785, height: 460 },
   }

   constructor(vehicle, options = {}) {
      super(options)
      this.vehicle = vehicle
      this.tab = "details"
      this._weaponOpen = true
      this._moduleView = this._loadModuleView()
      ensureSiegeCSS()
   }

   static _open = new Map()

   static open(vehicle) {
      if (!vehicle) return
      const existing = this._open.get(vehicle.id)
      if (existing) {
         existing.bringToFront?.()
         existing.render({ force: false })
         return existing
      }
      const hud = new VehicleHUD(vehicle)
      this._open.set(vehicle.id, hud)
      hud.render({ force: true })
      return hud
   }

   static refreshFor(vehicleId) {
      const hud = this._open.get(vehicleId)
      if (hud) hud.render({ force: false })
   }

   _onClose() {
      VehicleHUD._open.delete(this.vehicle?.id)
      return super._onClose?.()
   }

   get title() {
      return tKey("VehicleHUD.Title", { name: this.vehicle?.name ?? "" })
   }

   _localKey(suffix) {
      return `${MODULE_ID}.${game.user?.id || "user"}.${this.vehicle?.id || "vehicle"}.${suffix}`
   }

   _loadJSON(suffix, fallback) {
      try {
         return JSON.parse(localStorage.getItem(this._localKey(suffix))) ?? fallback
      } catch {
         return fallback
      }
   }

   _saveJSON(suffix, value) {
      try {
         localStorage.setItem(this._localKey(suffix), JSON.stringify(value))
      } catch {
         
      }
   }

   _loadModuleView() {
      const view = this._loadJSON("moduleView", null)
      return {
         x: Number(view?.x) || 0,
         y: Number(view?.y) || 0,
         scale: Number(view?.scale) || 1,
      }
   }

   _saveModuleView() {
      this._saveJSON("moduleView", this._moduleView)
   }

_crewPortrait() {
      const cp = this.vehicle.getFlag(MODULE_ID, "crewPortrait")
      return normalizePortraitData(cp, this.vehicle.img)
   }

   _allCrew() {
      const set = new Set([
         ...game.actors,
         ...(canvas?.tokens?.placeables?.map((t) => t.actor).filter(Boolean) ||
            []),
      ])
      return [...set]
   }

   _currentCrewman() {
      return VehicleEntryManager.activeCrewmanForVehicle(this.vehicle)
   }

   _occupants(positionTitle) {
      return this._allCrew().filter((a) =>
         a.itemTypes.effect.some(
            (e) =>
               e.getFlag(MODULE_ID, "siegeId") === this.vehicle.id &&
               e.getFlag(MODULE_ID, "position") === positionTitle,
         ),
      )
   }

   _rankFor(actor) {
      if (!this.vehicle.getFlag(MODULE_ID, "ranksEnabled")) return null
      const byVeh = actor.getFlag(MODULE_ID, "rankByVehicle") || {}
      let rankName = byVeh[this.vehicle.id]
      if (!rankName) {
         const eff = actor.itemTypes.effect.find(
            (e) =>
               e.getFlag(MODULE_ID, "siegeId") === this.vehicle.id &&
               e.getFlag(MODULE_ID, "position"),
         )
         rankName = eff?.getFlag(MODULE_ID, "rank")
      }
      if (!rankName) return null
      const r = (this.vehicle.getFlag(MODULE_ID, "ranks") || []).find(
         (x) => x.name === rankName,
      )
      return r ? { ...r, icon: rankIconPath(r.icon) } : null
   }

_shieldBarHTML(state) {
      const current = Math.max(0, Number(state.currentHp) || 0)
      const max = Math.max(1, Number(state.maxHp) || 1)
      const hardness = Math.max(0, Number(state.hardness) || 0)
      const pct = Math.max(0, Math.min(100, (current / max) * 100))
      const broken =
         state.broken || VehicleShieldManager.isBroken(current, max)
      const name = escapeHTML(state.name || tKey("Modules.Shield"))
      return `<div class="vh-shield-row ${broken ? "vh-shield-broken" : ""}">
         <div class="vh-shield-bar" data-tooltip="${name}">
            <div class="vh-shield-fill" style="width:${pct}%;"></div>
            <span class="vh-shield-text">
               <span class="vh-shield-numbers">${current} / ${max} (HD ${hardness})</span>
            </span>
         </div>
      </div>`
   }

   _shieldStatusHTML() {
      const activeSourceKeys = new Set(
         VehicleShieldManager.collectShieldEntries(this.vehicle).map(
            (entry) => entry.sourceKey,
         ),
      )
      const states = Object.values(
         VehicleShieldManager.shieldStates(this.vehicle) || {},
      ).filter((state) => {
         if (!state || Number(state.maxHp) <= 0) return false
         if (!activeSourceKeys.has(state.sourceKey)) return false
         return !!(
            (state.shieldItemId && this.vehicle.items.get(state.shieldItemId)) ||
            this.vehicle.items.find(
               (item) =>
                  item.getFlag(MODULE_ID, "moduleGenerated")?.kind ===
                     "shield" &&
                  item.getFlag(MODULE_ID, "moduleGenerated")?.sourceKey ===
                     state.sourceKey,
            )
         )
      })
      if (!states.length) return ""

      if (states.length === 1)
         return `<div class="vh-shield-status">${this._shieldBarHTML(states[0])}</div>`

      return `<details class="vh-shield-acc" open>
         <summary><i class="fa-solid fa-chevron-right vh-shield-chevron"></i><i class="fa-solid fa-shield"></i> ${tKey("Shield.Shields")}</summary>
         <div class="vh-shield-list">
            ${states.map((state) => this._shieldBarHTML(state)).join("")}
         </div>
      </details>`
   }

   _saveStatValue(save) {
      const substitute = SiegeCrewManager.vehicleSaveDisplaySubstitute(this.vehicle, save)
      if (substitute) return substitute.value
      const scope = this.vehicle.flags?.[MODULE_ID] || {}
      const direct = this.vehicle.getFlag(MODULE_ID, `saves.${save}.value`)
      const saveRoot = this.vehicle.getFlag(MODULE_ID, "saves")
      const candidates = [
         direct,
         saveRoot?.[save]?.value,
         foundry.utils.getProperty(scope, `saves.${save}.value`),
         foundry.utils.getProperty(this.vehicle.system || {}, `saves.${save}.value`),
         foundry.utils.getProperty(this.vehicle.system || {}, `saves.${save}.mod`),
      ]
      let base = 0
      for (const candidate of candidates) {
         const number = Number(candidate)
         if (Number.isFinite(number)) {
            base = number
            break
         }
      }
      const moduleBonus =
         Number(this.vehicle.getFlag(MODULE_ID, "moduleBonuses")?.saves?.[save]) || 0
      return base + moduleBonus
   }

   _saveStatHTML(save, icon, label) {
      const value = this._saveStatValue(save)
      return `<span class="vh-def-stat vh-save-stat" data-tooltip="${label}"><i class="fa-solid ${icon}"></i> ${value}</span>`
   }

   _tabDetails() {
      const p = this._crewPortrait()
      const sys = this.vehicle.system || {}
      const space = sys.details?.space || {}
      const dim = [
         space.wide ?? "—",
         space.long ?? "—",
         space.high ?? space.height ?? "—",
      ].join(" / ")
      const rarity = sys.traits?.rarity || "common"
      const rarityLabel =
         game.i18n.localize(CONFIG.PF2E?.rarityTraits?.[rarity] || "") ||
         rarity.charAt(0).toUpperCase() + rarity.slice(1)
      const loadStatus = VehicleLoadManager.status(this.vehicle)
      const rows = [
         [tKey("VehicleHUD.Dimensions"), dim],
         [tKey("VehicleHUD.LoadCapacity"), loadStatus.capacityLabel],
         [tKey("VehicleHUD.Grade"), rarityLabel],
         [tKey("VehicleHUD.Speed"), `${sys.details?.speed ?? "—"}`],
         [tKey("VehicleHUD.Price"), `${sys.details?.price ?? 0}`],
         [tKey("VehicleHUD.Bulk"), `${this.vehicle.getFlag(MODULE_ID, "bulk") ?? 0}`],
         [
            tKey("VehicleHUD.DisableDC"),
            `${this.vehicle.getFlag(MODULE_ID, "disableDC") ?? "—"}`,
         ],
         [tKey("VehicleHUD.Level"), `${sys.details?.level?.value ?? 0}`],
      ]
      const editBtn = game.user.isGM
         ? `<button class="vh-edit-portrait" data-tooltip="${tKey("VehicleHUD.EditPicture")}"><i class="fa-solid fa-pen"></i></button>`
         : ""

const hp = sys.attributes?.hp || {}
      const hpVal = hp.value ?? 0
      const hpMax = hp.max ?? 0
      const pct = hpMax > 0 ? Math.max(0, Math.min(100, (hpVal / hpMax) * 100)) : 0
      
      const light = 38 + (pct / 100) * 34 
      const fillColor = `hsl(212, 85%, ${light}%)`
      let threshClass = ""
      if (pct <= 25) threshClass = "vh-hp-crit"
      else if (pct <= 50) threshClass = "vh-hp-low"
      else if (pct < 75) threshClass = "vh-hp-warn"
      const hardness = sys.attributes?.hardness?.value ?? sys.attributes?.hardness ?? 0
      const ac = sys.attributes?.ac?.value ?? 0
      const combat = `
         <div class="vh-combat">
            <div class="vh-hp-bar ${threshClass}">
               <div class="vh-hp-fill" style="width:${pct}%; background:${fillColor};"></div>
               <span class="vh-hp-text">${hpVal} / ${hpMax}</span>
            </div>
            <div class="vh-defense">
               <span class="vh-def-stat" data-tooltip="${tKey("VehicleHUD.AC")}"><i class="fa-solid fa-shield"></i> ${ac}</span>
               <span class="vh-def-stat" data-tooltip="${tKey("VehicleHUD.Hardness")}"><i class="fa-solid fa-shield-halved"></i> ${hardness}</span>
               <span class="vh-def-separator">|</span>
               ${this._saveStatHTML("fortitude", "fa-chess-rook", tKey("Attributes.Fortitude"))}
               ${this._saveStatHTML("reflex", "fa-person-running", tKey("Attributes.Reflex"))}
               ${this._saveStatHTML("will", "fa-brain", tKey("Attributes.Will"))}
            </div>
            ${this._shieldStatusHTML()}
         </div>`

const weaponMini = this._weaponryRows()
      const weaponry = weaponMini.length
         ? `<div class="vh-weapon-acc ${this._weaponOpen ? "open" : ""}">
               <button class="vh-weapon-acc-head" data-action="toggle-weaponry">
                  <i class="fa-solid fa-chevron-${this._weaponOpen ? "down" : "right"}"></i>
                  ${tKey("VehicleHUD.Weaponry")}
               </button>
               <div class="vh-weapon-acc-body" ${this._weaponOpen ? "" : 'style="display:none;"'}>
                  ${weaponMini
                     .map(
                        (w) =>
                           `<div class="vh-mini-row"><img class="vh-mini-icon" src="${w.img}" alt=""><span class="vh-mini-name">${w.name}</span><span class="vh-mini-count">${w.loaded} / ${w.max}${w.usesAmmunition ? ` (${escapeHTML(w.ammoName)})` : ""}</span></div>`,
                     )
                     .join("")}
               </div>
            </div>`
         : ""

      return `
         <div class="vh-details-wrap">
            <div class="vh-details">
               <div class="vh-details-left">
                  <div class="vh-portrait-wrap">
                     <div class="vh-portrait">
                        ${
                           p.backgroundSrc
                              ? `<img class="vh-portrait-bg" src="${p.backgroundSrc}" style="${portraitBackgroundImgStyle(p)}">`
                              : ""
                        }
                        <img class="vh-portrait-img" src="${p.src}" style="${portraitImgStyle(p)}">
                     </div>
                     ${editBtn}
                  </div>
                  ${combat}
               </div>
               <div class="vh-stats-col">
                  <div class="vh-stats">
                     ${rows
                        .map(
                           ([k, v]) =>
                              `<div class="vh-stat"><span class="vh-stat-k">${k}</span><span class="vh-stat-v">${v}</span></div>`,
                        )
                        .join("")}
                  </div>
                  ${weaponry}
               </div>
            </div>
         </div>`
   }

async _promptAmount(action, mode) {
      const flag = action.getFlag(MODULE_ID, "siegeAction") || {}
      const slug =
         mode === "reload"
            ? AmmunitionManager.primaryAmmoSlugForAction(flag)
            : AmmunitionManager.activeAmmoSlug(this.vehicle, action)
      const max = parseInt(flag.maxLoaded) || 1
      const loaded = AmmunitionManager.getStrikeLoaded(this.vehicle, action)
      let cap, def
      if (mode === "reload") {
         if (!slug || !AmmunitionManager.ammoTypeFor(this.vehicle, slug)) {
            ui.notifications.warn(tKey("Notifications.UnassignedAmmo"))
            return null
         }
         const replacingCharged =
            AmmunitionManager.reloadNeedsChargedReplacement(this.vehicle, action)
         const avail = AmmunitionManager.ammoUsesCharges(this.vehicle, slug)
            ? AmmunitionManager.getAvailableLoadUnits(this.vehicle, slug)
            : AmmunitionManager.getAvailableUnits(this.vehicle, slug)
         cap = replacingCharged ? Math.min(1, avail) : Math.min(max - loaded, avail)
         def = cap
         if (cap <= 0) {
            ui.notifications.warn(tKey("Notifications.InsufficientAmmo"))
            return null
         }
      } else {
         cap = loaded
         def = loaded
         if (cap <= 0) {
            ui.notifications.info(tKey("Weaponry.NothingLoaded"))
            return null
         }
      }
      const title =
         mode === "reload" ? tKey("Weaponry.Reload") : tKey("Weaponry.Unload")
      const label =
         mode === "reload"
            ? tKey("Weaponry.ReloadAmount", { max: cap })
            : tKey("Weaponry.UnloadAmount", { max: cap })
      const result = await foundry.applications.api.DialogV2.wait({
         classes: ["siege-v2-dialog"],
         window: { title: `${title} — ${action.name}` },
         content: `<div style="padding:6px;">
            <label style="display:block;margin-bottom:4px;">${label}</label>
            <input type="number" class="vh-amount-input" value="${def}" min="1" max="${cap}" style="width:100%;">
         </div>`,
         buttons: [
            {
               action: "ok",
               label: title,
               default: true,
               callback: (e, button, dialog) => {
                  const r = dialog?.element ?? button?.form ?? null
                  const v =
                     r?.querySelector?.(".vh-amount-input")?.value ??
                     document.querySelector(".vh-amount-input")?.value
                  return Math.max(1, Math.min(cap, parseInt(v) || 1))
               },
            },
            { action: "cancel", label: tKey("CrewHUD.Cancel") },
         ],
      }).catch(() => null)
      return result === null || result === undefined ? null : result
   }

_weaponryRows() {
      const actions = this.vehicle.items.filter((i) => i.type === "action")
      const rows = []
      for (const a of actions) {
         const flag = a.getFlag(MODULE_ID, "siegeAction") || {}
         if (!(flag.isStrike || flag.isAttack)) continue
         const disabledReason = actionDisabledReason(flag)
         const usesAmmunition = flag.usesAmmunition !== false
         const max = parseInt(flag.maxLoaded) || 1
         const loaded = AmmunitionManager.getStrikeLoaded(this.vehicle, a)
         const ammoChoices = AmmunitionManager.ammoTypesForAction(this.vehicle, flag)
         const active = AmmunitionManager.getActiveLoadedPiece(this.vehicle, a)
         const usesCharges = !!active?.usesCharges
         const ammoDetail =
            ammoChoices.length > 0
               ? AmmunitionManager.weaponryAmmoDetail(this.vehicle, a)
               : ""
         const ammoName =
            loaded > 0
               ? AmmunitionManager.activeAmmoLabel(this.vehicle, a)
               : tKey("Weaponry.UnloadedState")
         rows.push({
            id: a.id,
            name: a.name,
            img: validImg(a.img, "icons/svg/target.svg"),
            ammoName,
            usesAmmunition,
            usesCharges,
            canSwitch: AmmunitionManager.canSwitchLoadedAmmo(this.vehicle, a),
            ammoDetail,
            loaded,
            max,
            costGlyph: getCostGlyph(a),
            detailHtml: actionDetailHTML(a, { weaponry: true }),
            ammoAccordionHtml: usesAmmunition
               ? ammoTypesAccordionHTML(this.vehicle, a)
               : "",
            disabled: !!disabledReason,
            disabledReason,
         })
      }
      return rows
   }

   _tabActions() {
      const actions = this.vehicle.items.filter((i) => {
         if (i.type !== "action") return false
         const flag = i.getFlag(MODULE_ID, "siegeAction") || {}
         return !(flag.isStrike || flag.isAttack)
      })
      if (actions.length === 0)
         return `<p class="vh-empty">${tKey("VehicleHUD.NoActions")}</p>`
      return `<div class="vh-actions-list">${actions
         .map((a) => {
            const flag = a.getFlag(MODULE_ID, "siegeAction") || {}
            const disabledReason = actionDisabledReason(flag)
            const access =
               flag.crewAccess && flag.crewAccess.length
                  ? flag.crewAccess.join(", ")
                  : tKey("VehicleHUD.AllCrew")
            return `<div class="vh-acc ${disabledReason ? "siege-action-disabled" : ""}" data-action-id="${a.id}">
               <div class="vh-acc-head">
                  <img class="vh-acc-icon" src="${validImg(a.img, "icons/svg/aura.svg")}" alt="">
                  <div class="vh-acc-titles">
                     <div class="vh-acc-name"><span class="siege-action-title-text">${a.name}</span>${getCostGlyph(a)}</div>
                     <div class="vh-acc-access"><i class="fa-solid fa-users"></i> ${access}</div>
                     ${
                        disabledReason
                           ? `<div class="vh-action-disabled-reason">${escapeHTML(disabledReason)}</div>`
                           : ""
                     }
                  </div>
                  <button class="vh-acc-toggle" data-action="toggle-acc"><i class="fa-solid fa-chevron-right"></i></button>
               </div>
               <div class="vh-acc-body" style="display:none;">${actionDetailHTML(a)}</div>
            </div>`
         })
         .join("")}</div>`
   }

   _tabWeaponry() {
      const rows = this._weaponryRows()
      if (rows.length === 0)
         return `<p class="vh-empty">${tKey("VehicleHUD.NoWeaponry")}</p>`
      return `<div class="vh-weapon-list">${rows
         .map((w) => {
            const buttons = `<div class="vh-weapon-btns">
               ${
                  w.usesAmmunition
                     ? `<button class="vh-weapon-btn vh-weapon-reload" data-action-id="${w.id}" ${w.disabled ? "disabled" : ""} data-tooltip="${tKey("Weaponry.Reload")}"><i class="fa-solid fa-rotate"></i></button>
                        <button class="vh-weapon-btn vh-weapon-switch-loaded" data-action-id="${w.id}" ${w.canSwitch && !w.disabled ? "" : "disabled"} data-tooltip="${tKey("Weaponry.SwitchLoaded")}"><i class="fa-solid fa-arrow-right-arrow-left"></i></button>`
                     : ""
               }
               ${
                  w.usesAmmunition
                     ? `<button class="vh-weapon-btn vh-weapon-unload" data-action-id="${w.id}" ${w.loaded > 0 && !w.disabled ? "" : "disabled"} data-tooltip="${tKey("Weaponry.Unload")}"><i class="fa-solid fa-arrow-down"></i></button>`
                     : ""
               }
            </div>`
            return `
            <div class="vh-weapon ${w.disabled ? "siege-action-disabled" : ""}" data-action-id="${w.id}">
               <div class="vh-weapon-head" data-action="toggle-weapon">
                  <img class="vh-weapon-icon" src="${w.img}" alt="">
                  <div class="vh-weapon-body">
                     <div class="vh-weapon-name"><span class="siege-action-title-text">${w.name}</span>${w.costGlyph}</div>
                     ${
                        w.disabled
                           ? `<div class="vh-action-disabled-reason">${escapeHTML(w.disabledReason)}</div>`
                           : ""
                     }
                  </div>
                  ${
                     w.usesAmmunition
                        ? `<span class="vh-weapon-count">${w.loaded} / ${w.max}</span>`
                        : ""
                  }
                  ${buttons}
                  <button class="vh-weapon-btn vh-weapon-toggle" type="button" data-tooltip="${tKey("VehicleHUD.PositionInfo")}"><i class="fa-solid fa-chevron-right"></i></button>
               </div>
               <div class="vh-weapon-detail" style="display:none;">
                  ${w.detailHtml}
                  ${
                     w.usesAmmunition
                        ? `<details class="vh-ammo-outer-acc">
                              <summary>
                                 <span><i class="fa-solid fa-bomb"></i> ${tKey("Weaponry.AmmunitionTypes")}</span>
                                 <i class="fa-solid fa-chevron-right chevron"></i>
                              </summary>
                              <div class="details-body">${w.ammoAccordionHtml}</div>
                           </details>`
                        : ""
                  }
               </div>
            </div>`
         })
         .join("")}</div>`
   }

   _tabCrew() {
      const positions = this.vehicle.getFlag(MODULE_ID, "crew") || []
      if (positions.length === 0)
         return `<p class="vh-empty">${tKey("VehicleHUD.NoPositions")}</p>`
      const ownedCrew = VehicleEntryManager.userOwnedCrewActors(
         this.vehicle,
         game.user,
      )
      const showSelector = ownedCrew.length > 1
      const selectedCrew = showSelector
         ? VehicleEntryManager.selectedCrewmanForVehicle(this.vehicle)
         : null
      const ownedCrewUuids = new Set(ownedCrew.map((actor) => actor.uuid))
      return `<div class="vh-crew-list">${positions
         .map((p) => {
            const occ = this._occupants(p.title)
            const minReq = parseInt(p.min ?? p.minReq) || 1
            const requiredBadge = `<span class="siege-req-badge ${occ.length >= minReq ? "siege-req-met" : "siege-req-unmet"}">${tKey("Mount.Required", { count: minReq })}</span>`
            const members = occ.length
               ? occ
                    .map((a) => {
                       const rank = this._rankFor(a)
                       const badge = rank
                          ? `<img class="vh-crew-rank" src="${rank.icon}" alt="${rank.abbr || ""}" title="${rank.name}">`
                          : ""
                       const prefix = rank && rank.abbr ? `${rank.abbr} ` : ""
                       const canSelect = showSelector && ownedCrewUuids.has(a.uuid)
                       const selector = canSelect
                          ? `<input type="checkbox" class="vh-crew-select" data-actor-uuid="${a.uuid}" ${selectedCrew?.uuid === a.uuid ? "checked" : ""} data-tooltip="${tKey("VehicleHUD.SelectedCrew")}">`
                          : ""
                       return `<div class="vh-crew-member" data-actor-uuid="${a.uuid}">
                          ${selector}${badge}<span>${prefix}${a.name}</span>
                       </div>`
                    })
                    .join("")
               : `<div class="vh-crew-empty">${tKey("VehicleHUD.PositionEmpty")}</div>`
            return `<div class="vh-crew-section">
               <div class="vh-crew-head">
                  <span class="vh-crew-title">${p.title} <span class="vh-crew-cap">${occ.length}/${parseInt(p.max) || 1}</span>${requiredBadge}</span>
                  <button class="vh-pos-info" data-position="${p.title}" data-tooltip="${tKey("VehicleHUD.PositionInfo")}"><i class="fa-solid fa-circle-info"></i></button>
               </div>
               <div class="vh-crew-members">${members}</div>
            </div>`
         })
         .join("")}</div>`
   }

   _tabDescription() {
      const desc = this.vehicle.system?.details?.description || ""
      return `<div class="vh-description">${desc || `<p class="vh-empty">${tKey("VehicleHUD.NoDescription")}</p>`}</div>`
   }

   _tabRanks() {
      const enabled = !!this.vehicle.getFlag(MODULE_ID, "ranksEnabled")
      const ranks = this.vehicle.getFlag(MODULE_ID, "ranks") || []
      const canEdit = game.user.isGM
      const rows = ranks
         .map(
            (r, i) => `
            <div class="vh-rank-row" data-index="${i}">
               <img class="vh-rank-icon" src="${rankIconPath(r.icon)}" alt="${r.abbr || ""}" ${canEdit ? `data-action="icon" title="${tKey("VehicleHUD.ChangeInsignia")}"` : `title="${r.name || ""}"`}>
               <input type="text" class="vh-rank-name" value="${r.name || ""}" placeholder="${tKey("VehicleHUD.RankName")}" ${canEdit ? "" : "readonly"}>
               <input type="text" class="vh-rank-abbr" value="${r.abbr || ""}" placeholder="${tKey("VehicleHUD.RankAbbr")}" ${canEdit ? "" : "readonly"}>
               ${canEdit ? `<button class="vh-rank-del" data-action="delete" data-tooltip="${tKey("VehicleHUD.DeleteRank")}"><i class="fa-solid fa-trash"></i></button>` : ""}
            </div>`,
         )
         .join("")
      return `
         <div class="vh-ranks">
            ${
               canEdit
                  ? `<label class="vh-ranks-toggle">
                     <input type="checkbox" class="vh-ranks-enabled" ${enabled ? "checked" : ""}>
                     ${tKey("VehicleHUD.EnableRanks")}
                  </label>`
                  : `<div class="vh-ranks-toggle">${enabled ? tKey("VehicleHUD.TabRanks") : tKey("VehicleHUD.RanksDisabled")}</div>`
            }
            ${
               enabled
                  ? `<div class="vh-ranks-list">${rows || `<p class="vh-empty">${tKey("VehicleHUD.NoRanks")}</p>`}</div>
                     ${canEdit ? `<div class="vh-ranks-actions">
                        <button class="vh-add-rank"><i class="fa-solid fa-plus"></i> ${tKey("VehicleHUD.AddRank")}</button>
                     </div>` : ""}`
                  : `<p class="vh-empty">${tKey("VehicleHUD.RanksDisabled")}</p>`
            }
         </div>`
   }

   _renderHTML() {
      const tabs = [
         ["details", tKey("VehicleHUD.TabDetails"), "fa-circle-info"],
         ["actions", tKey("VehicleHUD.TabActions"), "fa-bolt"],
         ["weaponry", tKey("VehicleHUD.TabWeaponry"), "fa-crosshairs"],
         ["stash", tKey("VehicleHUD.TabStash"), "fa-box-open"],
         ["modules", tKey("VehicleHUD.TabModules"), "fa-kaaba"],
         ["crew", tKey("VehicleHUD.TabCrewList"), "fa-users"],
         ["ranks", tKey("VehicleHUD.TabRanks"), "fa-ranking-star"],
         ["description", tKey("VehicleHUD.TabDescription"), "fa-align-left"],
      ]

      const nav = tabs
         .map(
            ([id, label, icon]) =>
               `<button class="vh-tab ${this.tab === id ? "active" : ""}" data-tab="${id}"><i class="fa-solid ${icon}"></i> ${label}</button>`,
         )
         .join("")

      let body = ""
      switch (this.tab) {
         case "actions": body = this._tabActions(); break
         case "weaponry": body = this._tabWeaponry(); break
         case "modules": body = this._tabModules(); break
         case "stash": body = this._tabStash(); break
         case "crew": body = this._tabCrew(); break
         case "description": body = this._tabDescription(); break
         case "ranks": body = this._tabRanks(); break
         default: body = this._tabDetails()
      }

      return `
         <div class="siege-vehicle-hud">
            <div class="vh-nav">${nav}</div>
            <div class="vh-body">${body}</div>
         </div>`
   }

   _replaceHTML(result, content) {
      content.innerHTML = result
   }

   async _saveRanks(ranks) {
      await this.vehicle.setFlag(MODULE_ID, "ranks", ranks)
   }


}

Object.assign(
   VehicleHUD.prototype,
   vehicleHudStashMethods,
   vehicleHudModuleRenderMethods,
   vehicleHudModuleMethods,
   vehicleHudRenderListenerMethods,
)
