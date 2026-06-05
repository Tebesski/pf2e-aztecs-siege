import { MODULE_ID, rankIconPath } from "../constants.mjs"
import { tKey, validImg, portraitImgStyle, getCostGlyph } from "../utils.mjs"
import { computePrereqData, getAmmoInfo } from "../macros/helpers.mjs"
import { AmmunitionManager } from "../managers/ammunition.mjs"



function vehicleSkills(vehicle, crewman) {
   const map = new Map() 
   const ensure = (key, label, mod) => {
      if (!map.has(key)) map.set(key, { label, mod, actions: new Set() })
      return map.get(key)
   }
   for (const item of vehicle.items) {
      if (item.type !== "action") continue
      const flag = item.getFlag(MODULE_ID, "siegeAction")
      if (!flag || !Array.isArray(flag.skills)) continue
      for (const s of flag.skills) {
         if (!s?.name) continue
         let key, label, mod
         if (s.name === "perception") {
            key = "perception"
            label = tKey("Skills.Perception")
            mod = crewman.perception?.mod ?? 0
         } else if (s.name === "lore") {
            const base = (s.loreName || "").replace(/-lore$/i, "")
            const loreSkill = Object.values(crewman.skills || {}).find((sk) => {
               const slug = sk.slug || ""
               return slug === s.loreName || slug.replace(/-lore$/i, "") === base
            })
            key = `lore:${base}`
            label = tKey("Skills.LoreSuffix", {
               name: base.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
            })
            mod = loreSkill ? loreSkill.mod : 0
         } else {
            const sk = crewman.skills?.[s.name]
            key = s.name
            label = sk?.label || s.name.replace(/\b\w/g, (c) => c.toUpperCase())
            mod = sk?.mod ?? 0
         }
         ensure(key, label, mod).actions.add(item.name)
      }
   }
   return [...map.values()]
      .map((v) => ({ ...v, actions: [...v.actions] }))
      .sort((a, b) => a.label.localeCompare(b.label))
}








export function actionDetailHTML(item, options = {}) {
   const rawFlag = { skills: [], ...(item.getFlag(MODULE_ID, "siegeAction") || {}) }
   const vehicle = item.parent
   const ammoPayload =
      rawFlag.usesAmmunition !== false && (rawFlag.isAttack || rawFlag.isStrike)
         ? AmmunitionManager.activeAmmoPayload(vehicle, item)
         : null
   const flag = ammoPayload
      ? AmmunitionManager.applyAmmoOverridesToFlag(rawFlag, ammoPayload)
      : rawFlag
   const sys = item.system || {}
   const desc = sys.description?.value || ""
   const weaponryMode = options.weaponry === true
   const dossierMode = options.dossier === true
   const compactAccessMode = weaponryMode || dossierMode

   
   let prereqData = []
   try {
      prereqData = computePrereqData(vehicle, flag, item) || []
   } catch {
      prereqData = []
   }
   if (weaponryMode)
      prereqData = prereqData.filter(
         (p) => p.name !== tKey("AttackTemplates.Loaded.Name"),
      )
   const prereqBox = !compactAccessMode && prereqData.length
      ? `<div class="siege-info-box">
            <p class="siege-no-margin"><strong>${tKey("ActionMacro.Prerequisites")}:</strong>
               ${prereqData
                  .map(
                     (p) =>
                        `<span class="siege-prereq-item">${p.name} ${
                           p.displayCount
                              ? p.displayCount + " "
                              : p.showCount
                                ? `${p.current} / ${p.required} `
                                : ""
                        }${p.fulfilled ? '<i class="fa-solid fa-check siege-icon-ok"></i>' : '<i class="fa-solid fa-times siege-icon-bad"></i>'}</span>`,
                  )
                  .join("")}
            </p>
         </div>`
      : ""

   
   const lines = []
   const isStrike = flag.isStrike || flag.isAttack
   if (
      isStrike &&
      flag.usesAmmunition !== false &&
      AmmunitionManager.ammoSlugsForAction(flag).length > 0
   ) {
      let ammoName = AmmunitionManager.ammoSlugsForAction(flag).join(" / ")
      let loaded = 0
      let max = parseInt(flag.maxLoaded) || 1
      try {
         const info = getAmmoInfo(vehicle, flag, item)
         ammoName = info.name || ammoName
         loaded = info.loaded ?? 0
         max = info.max ?? max
      } catch {
         
      }
      const spend = parseInt(flag.spend) || 1
      const loadedInfo = AmmunitionManager.loadedInfoForAction(vehicle, item)
      if (compactAccessMode)
         lines.push(
            `<p class="siege-detail-line"><strong>${tKey("AttackTemplates.Loaded.Name")}:</strong> ${loadedInfo.display}</p>`,
         )
      else {
         lines.push(
            `<p class="siege-detail-line"><strong>${tKey("ActionMacro.Ammunition")}:</strong> ${ammoName} (${tKey("CrewHUD.SpendN", { n: spend })})</p>`,
         )
         lines.push(
            `<p class="siege-detail-line"><strong>${tKey("VehicleHUD.Weaponry")}:</strong> ${loaded} / ${max}</p>`,
         )
      }
   }
   const savingActionTypes = new Set(["area-fire", "auto-fire", "save-single"])
   const isStrikeAbility = isStrike && flag.isAttack && !flag.isStrike
   const usesSaveOrTemplate =
      isStrikeAbility || savingActionTypes.has(String(flag.actionType || ""))
   const allowRangeLine = isStrike && !usesSaveOrTemplate
   if (allowRangeLine && isStrike && flag.isRanged === false) {
      lines.push(
         `<p class="siege-detail-line"><strong>${tKey("CrewHUD.ActRange")}:</strong> ${tKey("Weaponry.Melee")}</p>`,
      )
   } else if (
      allowRangeLine &&
      flag.isRanged !== false &&
      (flag.blindRange || flag.minRange || flag.rangeIncrement || flag.maxRange)
   ) {
      const parts = []
      if (flag.blindRange) parts.push(`${tKey("CrewHUD.RangeBlind")} ${flag.blindRange}`)
      if (flag.minRange) parts.push(`${tKey("CrewHUD.RangeMin")} ${flag.minRange}`)
      if (flag.rangeIncrement) parts.push(`${tKey("CrewHUD.RangeInc")} ${flag.rangeIncrement}`)
      if (flag.maxRange) parts.push(`${tKey("CrewHUD.RangeMax")} ${flag.maxRange}`)
      if (parts.length)
         lines.push(
            `<p class="siege-detail-line"><strong>${tKey("CrewHUD.ActRange")}:</strong> ${parts.join(" · ")} ft</p>`,
         )
   }
   if (flag.areaSize && flag.areaType && (flag.actionType || ammoPayload?.flags?.modifyArea)) {
      lines.push(
         `<p class="siege-detail-line"><strong>${tKey("ActionMacro.Area")}:</strong> ${flag.areaSize} ft ${flag.areaType}</p>`,
      )
   }
   if (isStrike && Array.isArray(flag.damageParts) && flag.damageParts.length) {
      const dmg = flag.damageParts
         .map((d) => `${d.dice || ""}${d.die || ""} ${d.type || ""}`.trim())
         .join(", ")
      if (dmg)
         lines.push(
            `<p class="siege-detail-line"><strong>${tKey("CrewHUD.ActDamage")}:</strong> ${dmg}</p>`,
         )
   }
   const traits = (flag.traits || (sys.traits?.value || []).join(", ")).toString()
   if (traits.trim())
      lines.push(
         `<p class="siege-detail-line"><strong>${tKey("CrewHUD.ActTraits")}:</strong> ${traits}</p>`,
      )

   const detailBox = lines.length
      ? `<div class="siege-action-details siege-info-box">${lines.join("")}</div>`
      : ""

   return `
      <div class="scd-act-detail siege-dialog-detail ${weaponryMode ? "vh-weapon-detail-large" : ""}">
         ${desc ? `<div class="details-desc">${desc}</div>` : ""}
         ${prereqBox}
         ${detailBox}
      </div>`
}

export class CrewDossier extends foundry.applications.api.ApplicationV2 {
   static DEFAULT_OPTIONS = {
      id: "siege-crew-dossier",
      classes: ["siege-crew-dossier-app"],
      window: { title: "Dossier", frame: true, positioned: true },
      position: { width: 400, height: "auto" },
   }

   constructor(actor, vehicle, options = {}) {
      super(options)
      this.actor = actor
      this.vehicle = vehicle
   }

   get title() {
      return tKey("CrewHUD.DossierTitle", { name: this.actor?.name ?? "" })
   }

   _effect() {
      return this.actor.itemTypes.effect.find(
         (e) =>
            e.getFlag(MODULE_ID, "siegeId") === this.vehicle?.id &&
            e.getFlag(MODULE_ID, "position"),
      )
   }

   _positionTitle() {
      return this._effect()?.getFlag(MODULE_ID, "position") || "\u2014"
   }

   _ranksEnabled() {
      return !!this.vehicle?.getFlag(MODULE_ID, "ranksEnabled")
   }

   _rank() {
      if (!this._ranksEnabled()) return null
      
      
      const byVeh = this.actor.getFlag(MODULE_ID, "rankByVehicle") || {}
      const rankName =
         byVeh[this.vehicle?.id] || this._effect()?.getFlag(MODULE_ID, "rank")
      if (!rankName) return null
      const r = (this.vehicle.getFlag(MODULE_ID, "ranks") || []).find(
         (x) => x.name === rankName,
      )
      if (!r) return null
      return { name: r.name, abbr: r.abbr, icon: rankIconPath(r.icon) }
   }

   _accessibleActions(position) {
      if (!this.vehicle) return []
      return this.vehicle.items.filter((a) => {
         if (a.type !== "action") return false
         const flag = a.getFlag(MODULE_ID, "siegeAction")
         if (!flag) return false
         const ca = flag.crewAccess
         return !ca || ca.length === 0 || ca.includes(position)
      })
   }

   _portrait() {
      const perVeh = foundry.utils.getProperty(
         this.actor,
         `flags.${MODULE_ID}.crewPortraitByVehicle.${this.vehicle?.id}`,
      )
      const cp = perVeh || this.actor.getFlag(MODULE_ID, "crewPortrait") || null
      if (cp && typeof cp === "object")
         return {
            src: validImg(cp.src || this.actor.img, this.actor.img),
            zoom: Math.max(1, cp.scale ?? 1),
            ox: cp.offsetX ?? 0,
            oy: cp.offsetY ?? 0,
         }
      return {
         src: validImg(
            (typeof cp === "string" ? cp : null) || this.actor.img,
            this.actor.img,
         ),
         zoom: 1,
         ox: 0,
         oy: 0,
      }
   }

   _hp() {
      const hp = this.actor.system?.attributes?.hp || {}
      const value = hp.value ?? 0
      const max = hp.max ?? 0
      const temp = hp.temp ?? 0
      const pct = max > 0 ? Math.round((value / max) * 100) : 0
      return { value, max, temp, pct }
   }

   
   _displayName() {
      const rank = this._rank()
      const prefix = rank && rank.abbr ? `${rank.abbr} ` : ""
      return `${prefix}${this.actor.name}`
   }

   _renderHTML() {
      const position = this._positionTitle()
      const rank = this._rank()
      const actions = this._accessibleActions(position)
      const portrait = this._portrait()
      const hp = this._hp()
      const skills = vehicleSkills(this.vehicle, this.actor)
      const hpColor =
         hp.pct > 66 ? "#3a8f43" : hp.pct > 33 ? "#a8881f" : "#9c3a35"

      const actionsList = actions.length
         ? actions
              .map(
                 (a, i) => `
               <div class="scd-acc" data-idx="${i}" data-action-id="${a.id}">
                  <button class="scd-acc-head">
                     <img class="scd-acc-icon" src="${validImg(a.img, "icons/svg/aura.svg")}" alt="">
                     <span class="scd-acc-name"><span class="siege-action-title-text">${a.name}</span>${getCostGlyph(a)}</span>
                     <i class="fa-solid fa-chevron-right scd-acc-caret"></i>
                  </button>
                  <div class="scd-acc-body" style="display:none;">${actionDetailHTML(a, { dossier: true })}</div>
               </div>`,
              )
              .join("")
         : `<div class="scd-none">${tKey("CrewHUD.DossierNoAccess")}</div>`

      const skillsList = skills.length
         ? `<div class="scd-skill-badges">${skills
              .map(
                 (s, i) =>
                    `<button class="scd-skill-badge" data-skill-idx="${i}">${s.label} <span class="scd-skill-mod">${s.mod >= 0 ? "+" : ""}${s.mod}</span></button>`,
              )
              .join("")}</div>`
         : `<div class="scd-none">${tKey("CrewHUD.DossierNoSkills")}</div>`

      
      
      let rankLine = ""
      if (this._ranksEnabled()) {
         rankLine = rank
            ? `<div class="scd-rank"><img class="scd-rank-icon" src="${rank.icon}" alt="${rank.abbr || ""}"><span class="scd-rank-name-link" data-action="assign-rank">${rank.name}</span></div>`
            : `<div class="scd-rank"><span class="scd-rank-assign" data-action="assign-rank">${tKey("CrewHUD.AssignRank")}</span></div>`
      }

      
      this._skills = skills

      return `
         <div class="siege-crew-dossier">
            <div class="scd-header">
               <div class="scd-portrait" data-action="open-sheet" title="${tKey("CrewHUD.OpenSheet")}" style="cursor:pointer;"><img class="scd-portrait-img" src="${portrait.src}" style="${portraitImgStyle(portrait)}"></div>
               <div class="scd-id">
                  <div class="scd-name">${this._displayName()}</div>
                  <div class="scd-pos"><i class="fa-solid fa-id-badge"></i> ${position}</div>
                  ${rankLine}
               </div>
            </div>

            <div class="scd-section">
               <div class="scd-section-title">${tKey("CrewHUD.DossierHP")}</div>
               <div class="scd-hp-bar">
                  <div class="scd-hp-fill" style="width:${hp.pct}%; background:${hpColor};"></div>
                  <span class="scd-hp-text">${hp.value} / ${hp.max}${hp.temp ? " (+" + hp.temp + ")" : ""}</span>
               </div>
            </div>

            <div class="scd-section">
               <div class="scd-section-title">${tKey("CrewHUD.DossierAccess")}</div>
               <div class="scd-actions">${actionsList}</div>
            </div>

            <div class="scd-section">
               <div class="scd-section-title">${tKey("CrewHUD.DossierSkills")}</div>
               ${skillsList}
            </div>
         </div>`
   }

   _replaceHTML(result, content) {
      content.innerHTML = result
   }

   _onRender() {
      const root = this.element
      wireAccordions(root)

      
      root
         .querySelector('.scd-portrait[data-action="open-sheet"]')
         ?.addEventListener("click", () => {
            if (this.actor?.testUserPermission(game.user, "LIMITED"))
               this.actor.sheet.render(true)
            else ui.notifications.warn(tKey("CrewHUD.NoSheetPermission"))
         })

      
      
      root.querySelectorAll(".scd-skill-badge").forEach((badge) => {
         badge.addEventListener("click", () => {
            const idx = Number(badge.dataset.skillIdx)
            const skill = this._skills?.[idx]
            if (!skill) return
            const items = this.vehicle.items.filter(
               (a) => a.type === "action" && skill.actions.includes(a.name),
            )
            new SkillActionsApp(skill.label, items).render(true)
         })
      })

      
      
      root.querySelectorAll('[data-action="assign-rank"]').forEach((el) => {
         el.addEventListener("click", async () => {
            if (game.user.isGM) {
               await this._assignRankDialog()
            } else {
               const { VehicleHUD } = await import("./vehicle-hud.mjs")
               const hud = VehicleHUD.open(this.vehicle)
               if (hud) {
                  hud.tab = "ranks"
                  hud.render({ force: false })
               }
            }
         })
      })
   }

   async _assignRankDialog() {
      const ranks = this.vehicle.getFlag(MODULE_ID, "ranks") || []
      if (ranks.length === 0) {
         ui.notifications.warn(tKey("CrewHUD.NoRanksDefined"))
         return
      }
      const byVeh = this.actor.getFlag(MODULE_ID, "rankByVehicle") || {}
      const current =
         byVeh[this.vehicle.id] ||
         this._effect()?.getFlag(MODULE_ID, "rank") ||
         ""
      
      const options = [`<option value="">${tKey("CrewHUD.NoRank")}</option>`]
         .concat(
            ranks.map(
               (r) =>
                  `<option value="${r.name}" ${r.name === current ? "selected" : ""}>${r.name}${r.abbr ? ` (${r.abbr})` : ""}</option>`,
            ),
         )
         .join("")
      const chosen = await foundry.applications.api.DialogV2.wait({
         classes: ["siege-v2-dialog"],
         window: { title: tKey("CrewHUD.AssignRank") },
         content: `<div style="padding:6px;"><select class="scd-rank-pick" style="width:100%;">${options}</select></div>`,
         buttons: [
            {
               action: "ok",
               label: tKey("CrewHUD.Confirm"),
               default: true,
               callback: (e, button, dialog) => {
                  const r = dialog?.element ?? button?.form ?? null
                  return (
                     r?.querySelector?.(".scd-rank-pick")?.value ??
                     document.querySelector(".scd-rank-pick")?.value ??
                     ""
                  )
               },
            },
            { action: "cancel", label: tKey("CrewHUD.Cancel") },
         ],
      }).catch(() => null)
      if (chosen === null) return
      
      
      const map = foundry.utils.deepClone(
         this.actor.getFlag(MODULE_ID, "rankByVehicle") || {},
      )
      if (chosen) map[this.vehicle.id] = chosen
      else delete map[this.vehicle.id]
      await this.actor.setFlag(MODULE_ID, "rankByVehicle", map)
      const eff = this._effect()
      if (eff) await eff.setFlag(MODULE_ID, "rank", chosen)
      this.render({ force: false })
      const { CrewHUD } = await import("./crew-hud.mjs")
      CrewHUD.refreshFor(this.vehicle.id)
      const { VehicleHUD } = await import("./vehicle-hud.mjs")
      VehicleHUD.refreshFor(this.vehicle.id)
   }
}


function wireAccordions(root) {
   if (!root) return
   root.querySelectorAll(".scd-acc-head").forEach((head) => {
      head.addEventListener("click", () => {
         const acc = head.closest(".scd-acc")
         const body = acc.querySelector(".scd-acc-body")
         const caret = head.querySelector(".scd-acc-caret")
         const open = body.style.display !== "none"
         body.style.display = open ? "none" : "block"
         if (caret)
            caret.className = `fa-solid fa-chevron-${open ? "right" : "down"} scd-acc-caret`
      })
   })
}



class SkillActionsApp extends foundry.applications.api.ApplicationV2 {
   static DEFAULT_OPTIONS = {
      id: "siege-skill-actions",
      classes: ["siege-v2-app", "siege-crew-dossier-app"],
      window: { title: "Skill", frame: true, positioned: true },
      position: { width: 360, height: "auto" },
   }
   constructor(skillLabel, items, options = {}) {
      super(options)
      this.skillLabel = skillLabel
      this.items = items
   }
   get title() {
      return `${this.skillLabel} — ${tKey("CrewHUD.DossierAccess")}`
   }
   _renderHTML() {
      const list = this.items.length
         ? this.items
              .map(
                 (a) => `
            <div class="scd-acc" data-action-id="${a.id}">
                  <button class="scd-acc-head">
                     <img class="scd-acc-icon" src="${validImg(a.img, "icons/svg/aura.svg")}" alt="">
                     <span class="scd-acc-name"><span class="siege-action-title-text">${a.name}</span>${getCostGlyph(a)}</span>
                     <i class="fa-solid fa-chevron-right scd-acc-caret"></i>
                  </button>
               <div class="scd-acc-body" style="display:none;">${actionDetailHTML(a, { dossier: true })}</div>
            </div>`,
         )
              .join("")
         : `<div class="scd-none">${tKey("CrewHUD.DossierNoAccess")}</div>`
      return `<div class="siege-crew-dossier"><div class="scd-section"><div class="scd-actions">${list}</div></div></div>`
   }
   _replaceHTML(result, content) {
      content.innerHTML = result
   }
   _onRender() {
      wireAccordions(this.element)
   }
}
