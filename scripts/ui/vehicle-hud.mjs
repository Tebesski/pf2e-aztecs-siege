import { MODULE_ID, DEFAULT_RANKS, rankIconPath } from "../constants.mjs"
import { slugify, tKey, validImg, portraitImgStyle, getCostGlyph } from "../utils.mjs"
import { ensureSiegeCSS } from "../macros/helpers.mjs"
import { actionDetailHTML } from "./crew-dossier.mjs"
import { ammoDetailHTML, ammoTypesAccordionHTML } from "./ammo-details.mjs"
import { AmmunitionManager } from "../managers/ammunition.mjs"
import { SiegeSFXManager } from "../managers/sfx.mjs"
import { VehicleLoadManager } from "../managers/vehicle-load.mjs"

const escapeHTML = (value) =>
   foundry.utils.escapeHTML?.(String(value ?? "")) ?? String(value ?? "")

const capitalizeForHud = (value) =>
   String(value || "")
      .replace(/-/g, " ")
      .replace(/\b\w/g, (m) => m.toUpperCase())




export class VehicleHUD extends foundry.applications.api.ApplicationV2 {
   static DEFAULT_OPTIONS = {
      id: "siege-vehicle-hud",
      classes: ["siege-vehicle-hud-app"],
      window: { title: "Vehicle", frame: true, positioned: true },
      position: { width: 720, height: 460 },
   }

   constructor(vehicle, options = {}) {
      super(options)
      this.vehicle = vehicle
      this.tab = "details"
      this._weaponOpen = true
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

   

   _crewPortrait() {
      const cp = this.vehicle.getFlag(MODULE_ID, "crewPortrait")
      if (cp && typeof cp === "object")
         return {
            src: validImg(cp.src || this.vehicle.img, this.vehicle.img),
            zoom: Math.max(1, cp.scale ?? 1),
            ox: cp.offsetX ?? 0,
            oy: cp.offsetY ?? 0,
         }
      return {
         src: validImg(
            (typeof cp === "string" ? cp : null) || this.vehicle.img,
            this.vehicle.img,
         ),
         zoom: 1,
         ox: 0,
         oy: 0,
      }
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
      const isCrewOfVehicle = (actor) =>
         actor?.itemTypes?.effect?.some(
            (e) =>
               e.getFlag(MODULE_ID, "siegeId") === this.vehicle.id &&
               e.getFlag(MODULE_ID, "position"),
         )
      const controlled = canvas?.tokens?.controlled
         ?.map((t) => t.actor)
         .find((a) => isCrewOfVehicle(a) && a.testUserPermission(game.user, "OWNER"))
      if (controlled) return controlled
      if (isCrewOfVehicle(game.user.character)) return game.user.character
      return this._allCrew().find(
         (a) => isCrewOfVehicle(a) && (game.user.isGM || a.testUserPermission(game.user, "OWNER")),
      )
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
            </div>
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
                     <div class="vh-portrait"><img class="vh-portrait-img" src="${p.src}" style="${portraitImgStyle(p)}"></div>
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
            active?.name ||
            ammoChoices.map(({ type }) => type.name).join(" / ") ||
            tKey("Ammunition.TypeUnassigned")
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
            const access =
               flag.crewAccess && flag.crewAccess.length
                  ? flag.crewAccess.join(", ")
                  : tKey("VehicleHUD.AllCrew")
            return `<div class="vh-acc" data-action-id="${a.id}">
               <div class="vh-acc-head">
                  <img class="vh-acc-icon" src="${validImg(a.img, "icons/svg/aura.svg")}" alt="">
                  <div class="vh-acc-titles">
                     <div class="vh-acc-name"><span class="siege-action-title-text">${a.name}</span>${getCostGlyph(a)}</div>
                     <div class="vh-acc-access"><i class="fa-solid fa-users"></i> ${access}</div>
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
      const isGM = game.user.isGM
      return `<div class="vh-weapon-list">${rows
         .map((w) => {
            const buttons = `<div class="vh-weapon-btns">
               ${
                  w.usesAmmunition
                     ? `<button class="vh-weapon-btn vh-weapon-reload" data-action-id="${w.id}" data-tooltip="${tKey("Weaponry.Reload")}"><i class="fa-solid fa-rotate"></i></button>
                        <button class="vh-weapon-btn vh-weapon-switch-loaded" data-action-id="${w.id}" ${w.canSwitch ? "" : "disabled"} data-tooltip="${tKey("Weaponry.SwitchLoaded")}"><i class="fa-solid fa-arrow-right-arrow-left"></i></button>`
                     : ""
               }
               ${
                  isGM && w.usesAmmunition
                     ? `<button class="vh-weapon-btn vh-weapon-unload" data-action-id="${w.id}" ${w.loaded > 0 ? "" : "disabled"} data-tooltip="${tKey("Weaponry.Unload")}"><i class="fa-solid fa-arrow-down"></i></button>`
                     : ""
               }
            </div>`
            return `
            <div class="vh-weapon" data-action-id="${w.id}">
               <div class="vh-weapon-head" data-action="toggle-weapon">
                  <img class="vh-weapon-icon" src="${w.img}" alt="">
                  <div class="vh-weapon-body">
                     <div class="vh-weapon-name"><span class="siege-action-title-text">${w.name}</span>${w.costGlyph}</div>
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

   _formatStashMetaValue(value) {
      if (value === undefined || value === null || value === "")
         return tKey("Misc.None")
      if (Array.isArray(value))
         return value.length ? value.map((v) => escapeHTML(v)).join(", ") : tKey("Misc.None")
      if (typeof value === "object") {
         if (value.value !== undefined) return this._formatStashMetaValue(value.value)
         const entries = Object.entries(value).filter(
            ([, v]) => v !== undefined && v !== null && v !== "" && Number(v) !== 0,
         )
         if (!entries.length) return tKey("Misc.None")
         return entries
            .map(([k, v]) => `${escapeHTML(v)} ${escapeHTML(k)}`)
            .join(", ")
      }
      return escapeHTML(value)
   }

   _formatStashBulk(value) {
      if (value === undefined || value === null || value === "")
         return "-"
      if (typeof value === "object") {
         if (value.value !== undefined) return this._formatStashBulk(value.value)
         if (value.normal !== undefined) return this._formatStashBulk(value.normal)
      }
      const text = String(value).trim()
      if (!text) return "-"
      if (/^(?:l|light)$/i.test(text)) return "L"
      if (/^(?:-|negligible|neg)$/i.test(text)) return "-"
      const numeric = Number(text)
      if (Number.isFinite(numeric)) {
         if (numeric <= 0) return "-"
         if (Math.abs(numeric - 0.1) < 0.0001) return "L"
      }
      return escapeHTML(text)
   }

   _rarityLabel(rarity) {
      const slug = String(rarity || "").trim()
      if (!slug) return tKey("Misc.None")
      return (
         game.i18n.localize(CONFIG.PF2E?.rarityTraits?.[slug] || "") ||
         capitalizeForHud(slug)
      )
   }

   _traitLabel(trait) {
      const slug = String(trait || "").trim()
      if (!slug) return ""
      const localized =
         CONFIG.PF2E?.itemTraits?.[slug] ||
         CONFIG.PF2E?.actionTraits?.[slug] ||
         CONFIG.PF2E?.weaponTraits?.[slug]
      return game.i18n.localize(localized || "") || capitalizeForHud(slug)
   }

   _stashItemDetailHTML(item) {
      const system = item.system || {}
      const qty = system.quantity ?? 1
      const bulk = system.bulk?.value ?? system.bulk?.normal ?? system.bulk
      const price = system.price?.value ?? system.price ?? ""
      const rarity =
         system.traits?.rarity ?? system.rarity?.value ?? system.rarity ?? ""
      const level = system.level?.value ?? system.level ?? ""
      const traits = Array.isArray(system.traits?.value)
         ? system.traits.value.map((t) => this._traitLabel(t)).filter(Boolean)
         : []
      const rawDescription =
         system.description?.value ||
         (typeof system.description === "string" ? system.description : "")
      const description =
         rawDescription || `<p class="vh-empty">${tKey("Stash.NoDescription")}</p>`
      const meta = [
         [tKey("Stash.Quantity"), qty],
         [tKey("Stash.Bulk"), this._formatStashBulk(bulk)],
         [tKey("Stash.Price"), price],
         [tKey("Stash.Rarity"), this._rarityLabel(rarity)],
         [tKey("Stash.Level"), level],
         [tKey("Stash.Traits"), traits],
      ]
      const ammo = AmmunitionManager.isAmmoItem(item)
         ? ammoDetailHTML(
              this.vehicle,
              null,
              item.system?.slug || slugify(item.name),
              { item, showLoaded: false },
           )
         : ""
      return `<div class="vh-stash-detail-inner">
         <div class="vh-stash-description">
            <strong>${tKey("Stash.Description")}</strong>
            <div>${description}</div>
         </div>
         <div class="vh-stash-meta-grid">
            ${meta
               .map(
                  ([k, v]) =>
                     `<div class="vh-stash-meta-row"><strong>${k}</strong><span>${this._formatStashMetaValue(v)}</span></div>`,
               )
               .join("")}
         </div>
         ${ammo ? `<div class="vh-stash-ammo-detail">${ammo}</div>` : ""}
      </div>`
   }

   
   
   
   _tabStash() {
      const items = this.vehicle.items.filter(
         (i) =>
            !i.getFlag(MODULE_ID, "isEnteredCargoItem") &&
            ((i.isOfType && i.isOfType("physical")) ||
               ["weapon", "armor", "equipment", "consumable", "treasure", "backpack", "ammunition"].includes(
                  i.type,
               )),
      )
      if (items.length === 0)
         return `<div class="vh-stash vh-stash-drop"><p class="vh-empty">${tKey("Stash.Empty")}</p></div>`

      
      const order = [
         "ammunition",
         "weapon",
         "armor",
         "equipment",
         "consumable",
         "treasure",
         "backpack",
      ]
      const labelKey = {
         ammunition: "Stash.CatAmmunition",
         weapon: "Stash.CatWeapons",
         armor: "Stash.CatArmor",
         equipment: "Stash.CatEquipment",
         consumable: "Stash.CatConsumables",
         treasure: "Stash.CatTreasure",
         backpack: "Stash.CatContainers",
         other: "Stash.CatOther",
      }
      const buckets = {}
      for (const i of items) {
         const cat = AmmunitionManager.isAmmoItem(i)
            ? "ammunition"
            : order.includes(i.type)
              ? i.type
              : "other"
         ;(buckets[cat] = buckets[cat] || []).push(i)
      }

      const renderItem = (i) => {
         const qty = i.system?.quantity ?? 1
         const charge = AmmunitionManager._chargeInfo(i)
         const chargeText = charge.usesCharges
            ? ` (${charge.value}/${charge.max})`
            : ""
         return `<div class="vh-stash-item vh-stash-accordion" data-item-id="${i.id}" draggable="true">
            <div class="vh-stash-head" data-action="toggle-stash-item">
               <img class="vh-stash-icon" src="${validImg(i.img, "icons/svg/item-bag.svg")}" alt="">
               <div class="vh-stash-body">
                  <div class="vh-stash-name">${escapeHTML(i.name)}</div>
               </div>
               <span class="vh-stash-qty">x${qty}${chargeText}</span>
               <button class="vh-acc-toggle vh-stash-toggle" type="button" data-tooltip="${tKey("VehicleHUD.PositionInfo")}"><i class="fa-solid fa-chevron-right"></i></button>
            </div>
            <div class="vh-stash-detail" style="display:none;">
               ${this._stashItemDetailHTML(i)}
            </div>
         </div>`
      }

      const sections = [...order, "other"]
         .filter((cat) => buckets[cat]?.length)
         .map(
            (cat) => `<div class="vh-stash-cat">
               <div class="vh-stash-cat-head">${tKey(labelKey[cat])} <span class="vh-stash-cat-count">${buckets[cat].length}</span></div>
               <div class="vh-stash-cat-items">${buckets[cat].map(renderItem).join("")}</div>
            </div>`,
         )
         .join("")

      return `<div class="vh-stash vh-stash-drop"><div class="vh-stash-list">${sections}</div></div>`
   }

   _tabCrew() {
      const positions = this.vehicle.getFlag(MODULE_ID, "crew") || []
      if (positions.length === 0)
         return `<p class="vh-empty">${tKey("VehicleHUD.NoPositions")}</p>`
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
                       return `<div class="vh-crew-member" data-actor-uuid="${a.uuid}">
                          ${badge}<span>${prefix}${a.name}</span>
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

   _onRender() {
      const root = this.element

      if (!this._positioned) {
         try {
            this.setPosition({
               left: 20,
               top: Math.max(40, Math.round((window.innerHeight - 460) / 2)),
            })
         } catch (e) {
            
         }
         this._positioned = true
      }

      
      root.querySelectorAll(".vh-tab").forEach((el) => {
         el.addEventListener("click", () => {
            const previous = this.tab
            this.tab = el.dataset.tab
            if (this.tab === "stash" && previous !== "stash")
               SiegeSFXManager.playIfConfigured(this.vehicle, "openStash")
            this.render({ force: false })
         })
      })

      
      
      root.querySelector(".vh-edit-portrait")?.addEventListener("click", async () => {
         const { CrewPortraitDialog } = await import("./crew-portrait.mjs")
         new CrewPortraitDialog(this.vehicle, this.vehicle.id, {
            vehiclePortrait: true,
         }).render(true)
      })

      
      root
         .querySelector('[data-action="toggle-weaponry"]')
         ?.addEventListener("click", () => {
            this._weaponOpen = !this._weaponOpen
            this.render({ force: false })
         })

      
      root.querySelectorAll(".vh-acc-head").forEach((el) => {
         el.addEventListener("click", (e) => {
            e.preventDefault()
            e.stopPropagation()
            const acc = el.closest(".vh-acc")
            const body = acc.querySelector(".vh-acc-body")
            const caret = acc.querySelector(".vh-acc-toggle i")
            const open = body.style.display !== "none"
            body.style.display = open ? "none" : "block"
            if (caret)
               caret.className = `fa-solid fa-chevron-${open ? "right" : "down"}`
         })
      })

      
      
      root.querySelectorAll('.vh-weapon-head[data-action="toggle-weapon"]').forEach((el) => {
         el.addEventListener("click", (e) => {
            if (e.target.closest(".vh-weapon-btns")) return
            e.preventDefault()
            const row = el.closest(".vh-weapon")
            const body = row?.querySelector(".vh-weapon-detail")
            const caret = row?.querySelector(".vh-weapon-toggle i")
            if (!body) return
            const open = body.style.display !== "none"
            body.style.display = open ? "none" : "block"
            row.classList.toggle("open", !open)
            if (caret)
               caret.className = `fa-solid fa-chevron-${open ? "right" : "down"}`
         })
      })

      
      root.querySelectorAll('.vh-stash-head[data-action="toggle-stash-item"]').forEach((el) => {
         el.addEventListener("click", (e) => {
            e.preventDefault()
            const row = el.closest(".vh-stash-item")
            const body = row?.querySelector(".vh-stash-detail")
            const caret = row?.querySelector(".vh-stash-toggle i")
            if (!body) return
            const open = body.style.display !== "none"
            body.style.display = open ? "none" : "block"
            row.classList.toggle("open", !open)
            if (caret)
               caret.className = `fa-solid fa-chevron-${open ? "right" : "down"}`
         })
      })

      root.querySelectorAll(".vh-ammo-outer-acc, .siege-ammo-type-detail").forEach((d) => {
         d.addEventListener("toggle", () => {
            const ch = d.querySelector(":scope > summary .chevron")
            if (ch)
               ch.className = `fa-solid fa-chevron-${d.open ? "down" : "right"} chevron`
         })
      })

      root.querySelectorAll(".vh-weapon-reload").forEach((el) => {
         el.addEventListener("click", async (e) => {
            e.preventDefault()
            e.stopPropagation()
            const action = this.vehicle.items.get(el.dataset.actionId)
            if (!action) return
            const crewman = this._currentCrewman()
            if (!crewman)
               return ui.notifications.warn(tKey("Notifications.NotMountedOnSiege"))
            const { runLoadActionForStrike } = await import("../macros/action.mjs")
            await runLoadActionForStrike(this.vehicle, crewman, action, e)
            this.render({ force: false })
         })
      })

      root.querySelectorAll(".vh-weapon-switch-loaded").forEach((el) => {
         el.addEventListener("click", async (e) => {
            e.preventDefault()
            e.stopPropagation()
            if (el.disabled) return
            const action = this.vehicle.items.get(el.dataset.actionId)
            if (!action) return
            const { SiegeSocketManager } = await import("../managers/sockets.mjs")
            await SiegeSocketManager.switchLoadedAmmo(this.vehicle, action)
            this.render({ force: false })
         })
      })

      
      root.querySelectorAll(".vh-weapon-unload").forEach((el) => {
         el.addEventListener("click", async (e) => {
            e.preventDefault()
            e.stopPropagation()
            if (el.disabled) return
            const action = this.vehicle.items.get(el.dataset.actionId)
            if (!action) return
            const active = AmmunitionManager.getActiveLoadedPiece(this.vehicle, action)
            const usesCharges = !!active?.usesCharges
            const amount = usesCharges
               ? null
               : await this._promptAmount(action, "unload")
            if (!usesCharges && amount === null) return
            const { SiegeSocketManager } = await import("../managers/sockets.mjs")
            await SiegeSocketManager.unloadStrike(this.vehicle, action, amount)
            this.render({ force: false })
         })
      })

      
      root.querySelectorAll(".vh-stash-take").forEach((el) => {
         el.addEventListener("click", async (e) => {
            e.preventDefault()
            const item = this.vehicle.items.get(el.dataset.itemId)
            if (!item) return
            const { SiegeSocketManager } = await import("../managers/sockets.mjs")
            await SiegeSocketManager.takeStashItem(
               this.vehicle.id,
               item.id,
               game.user.id,
            )
            this.render({ force: false })
         })
      })

      
      
      
      root.querySelectorAll(".vh-stash-item[draggable='true']").forEach((el) => {
         el.addEventListener("dragstart", (e) => {
            const item = this.vehicle.items.get(el.dataset.itemId)
            if (!item) return
            const payload = {
               type: "Item",
               uuid: item.uuid,
               
               siegeStashMove: {
                  vehicleId: this.vehicle.id,
                  itemId: item.id,
               },
            }
            e.dataTransfer.setData("text/plain", JSON.stringify(payload))
            e.dataTransfer.setData("application/json", JSON.stringify(payload))
            e.dataTransfer.effectAllowed = "all"
            if (item.img) {
               const img = new Image()
               img.src = item.img
               try {
                  e.dataTransfer.setDragImage(img, 16, 16)
               } catch {
                  
               }
            }
         })
      })

      
      const dropZone = root.querySelector(".vh-stash-drop")
      if (dropZone) {
         const readDropData = (event) => {
            const helper =
               foundry.applications?.ux?.TextEditor?.implementation
                  ?.getDragEventData
            try {
               const data = helper?.(event)
               if (data) return data
            } catch {
               
            }
            const tryParse = (raw) => {
               if (!raw) return null
               try {
                  return JSON.parse(raw)
               } catch {
                  return null
               }
            }
            return (
               tryParse(event.dataTransfer.getData("application/json")) ||
               tryParse(event.dataTransfer.getData("text/json")) ||
               tryParse(event.dataTransfer.getData("text/plain"))
            )
         }

         const resolveDroppedItem = async (data) => {
            if (!data || data.type !== "Item") return null
            if (data.uuid || data.documentUuid)
               return fromUuid(data.uuid || data.documentUuid)
            if (data.id) {
               const worldItem = game.items.get(data.id)
               if (worldItem) return worldItem
               const actor = data.actorId ? game.actors.get(data.actorId) : null
               if (actor) return actor.items.get(data.id) || null
            }
            return null
         }

         dropZone.addEventListener("dragover", (e) => {
            e.preventDefault()
            e.stopPropagation()
            dropZone.classList.add("vh-stash-dragover")
         })
         dropZone.addEventListener("dragleave", () =>
            dropZone.classList.remove("vh-stash-dragover"),
         )
         dropZone.addEventListener("drop", async (e) => {
            e.preventDefault()
            e.stopPropagation()
            e.stopImmediatePropagation?.()
            dropZone.classList.remove("vh-stash-dragover")
            const data = readDropData(e)
            const item = await resolveDroppedItem(data)
            if (!item) return
            const { SiegeSocketManager } = await import("../managers/sockets.mjs")
            await SiegeSocketManager.putStashItem(
               this.vehicle.id,
               item.uuid,
               game.user.id,
            )
            this.render({ force: false })
         })
      }

      
      root.querySelectorAll(".vh-crew-member").forEach((el) => {
         el.addEventListener("click", async () => {
            const actor = await fromUuid(el.dataset.actorUuid)
            if (!actor) return
            const { CrewDossier } = await import("./crew-dossier.mjs")
            new CrewDossier(actor, this.vehicle).render(true)
         })
      })

      
      
      root.querySelectorAll(".vh-pos-info").forEach((el) => {
         el.addEventListener("click", async () => {
            const title = el.dataset.position
            const pos = (this.vehicle.getFlag(MODULE_ID, "crew") || []).find(
               (p) => p.title === title,
            )
            if (!pos) return
            const { buildPositionsData } = await import("../macros/mount.mjs")
            const { renderHbs, tplPath } = await import("../utils.mjs")
            const positions = await buildPositionsData(this.vehicle, [pos])
            const content = await renderHbs(
               tplPath("macros/position-info.hbs"),
               { positions },
            )
            const { ensureSiegeCSS } = await import("../macros/helpers.mjs")
            ensureSiegeCSS()
            class PositionInfoApp extends foundry.applications.api
               .ApplicationV2 {
               static DEFAULT_OPTIONS = {
                  window: { title, frame: true, positioned: true },
                  position: { width: 440, height: "auto" },
                  classes: ["siege-v2-app", "siege-mount-app"],
               }
               _renderHTML() {
                  return content
               }
               _replaceHTML(result, c) {
                  c.innerHTML = result
               }
               _onRender() {
                  
                  this.element
                     .querySelectorAll("details")
                     .forEach((d) =>
                        d.addEventListener("toggle", () => {
                           const ch = d.querySelector(":scope > summary .chevron")
                           if (ch)
                              ch.className = `fa-solid fa-chevron-${d.open ? "down" : "right"} chevron`
                        }),
                     )
               }
            }
            new PositionInfoApp().render(true)
         })
      })

      if (game.user.isGM) {
         root.querySelector(".vh-ranks-enabled")?.addEventListener("change", async (e) => {
            const on = e.target.checked
            await this.vehicle.setFlag(MODULE_ID, "ranksEnabled", on)
            if (on && (this.vehicle.getFlag(MODULE_ID, "ranks") || []).length === 0)
               await this._saveRanks(foundry.utils.deepClone(DEFAULT_RANKS))
            this.render({ force: false })
         })
         root.querySelector(".vh-add-rank")?.addEventListener("click", async () => {
            const ranks = foundry.utils.deepClone(
               this.vehicle.getFlag(MODULE_ID, "ranks") || [],
            )
            ranks.push({ name: tKey("VehicleHUD.NewRank"), abbr: "", icon: "assets/1.png" })
            await this._saveRanks(ranks)
            this.render({ force: false })
         })
         root.querySelectorAll(".vh-rank-row").forEach((row) => {
            const index = Number(row.dataset.index)
            const commit = async (patch) => {
               const ranks = foundry.utils.deepClone(
                  this.vehicle.getFlag(MODULE_ID, "ranks") || [],
               )
               if (!ranks[index]) return
               Object.assign(ranks[index], patch)
               await this._saveRanks(ranks)
            }
            row
               .querySelector(".vh-rank-name")
               ?.addEventListener("change", (e) => commit({ name: e.target.value }))
            row
               .querySelector(".vh-rank-abbr")
               ?.addEventListener("change", (e) => commit({ abbr: e.target.value }))
            row.querySelector('[data-action="delete"]')?.addEventListener("click", async () => {
               const ranks = foundry.utils.deepClone(
                  this.vehicle.getFlag(MODULE_ID, "ranks") || [],
               )
               ranks.splice(index, 1)
               await this._saveRanks(ranks)
               this.render({ force: false })
            })
            row.querySelector('[data-action="icon"]')?.addEventListener("click", () => {
               const FP =
                  foundry.applications?.apps?.FilePicker?.implementation ||
                  globalThis.FilePicker
               const ranks = this.vehicle.getFlag(MODULE_ID, "ranks") || []
               const fp = new FP({
                  type: "image",
                  current: rankIconPath(ranks[index]?.icon),
                  callback: async (path) => {
                     await commit({ icon: path })
                     this.render({ force: false })
                  },
               })
               fp.render(true)
            })
         })
      }

      
      const frame = this.element
      if (frame) {
         frame.querySelector(".crew-bookmarks")?.remove()
         const wrap = document.createElement("div")
         wrap.className = "crew-bookmarks"
         wrap.innerHTML = `
            <button class="crew-bookmark" data-tab="crew" data-tooltip="${tKey("CrewHUD.TabCrew")}"><i class="fa-solid fa-users"></i></button>
            <button class="crew-bookmark crew-bookmark-active" data-tab="vehicle" data-tooltip="${tKey("CrewHUD.TabVehicle")}"><i class="fa-solid fa-gears"></i></button>`
         frame.appendChild(wrap)
         wrap.querySelector('[data-tab="crew"]')?.addEventListener("click", async () => {
            const { CrewHUD } = await import("./crew-hud.mjs")
            this.close()
            CrewHUD.open(this.vehicle)
         })
      }
   }
}
