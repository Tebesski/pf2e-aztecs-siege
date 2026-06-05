import {
   MODULE_ID,
   PF2E_SKILLS,
   PF2E_DAMAGE_TYPES,
   WEAPON_PROFS,
   DAMAGE_CATEGORIES,
   AREA_TYPES,
   DIE_SIZES,
} from "../constants.mjs"
import { slugify, renderHbs, tplPath, capitalize, tKey } from "../utils.mjs"

const DEFAULT_DAMAGE_PART = {
   dice: 1,
   die: "d6",
   type: "bludgeoning",
   category: "normal",
}

const ACTION_TYPE_OPTIONS_BASE = [
   { value: "area-fire", labelKey: "ActionTab.AreaFire" },
   { value: "auto-fire", labelKey: "ActionTab.AutoFire" },
   { value: "save-single", labelKey: "ActionTab.SingleTarget" },
]

const PROFICIENCY_LABELS = {
   unarmed: "ActionTab.Proficiencies",
   simple: "ActionTab.Proficiencies",
   martial: "ActionTab.Proficiencies",
   advanced: "ActionTab.Proficiencies",
}

export class SiegeActionsUI {
   static renderSheetTab(app, html, data, item) {
      html.find(".siege-nav-item").remove()
      html.find(".siege-tab").remove()

      if (app._siegeActionTab === undefined)
         app._siegeActionTab = app._tabs?.[0]?.active ?? "description"

      html.on("click", ".sheet-navigation .item, .tabs [data-tab]", (ev) => {
         app._siegeActionTab = $(ev.currentTarget).data("tab")
         if (app._tabs?.[0]) app._tabs[0].active = app._siegeActionTab
      })

      const flags = this._normalizeFlags(item.getFlag(MODULE_ID, "siegeAction") || {})
      const templateData = this._buildTemplateData(item, flags)

      renderHbs(tplPath("sheet/action-tab.hbs"), templateData).then(
         (tabHtml) => {
            const tabNav = html
               .find(".sheet-navigation .item, .tabs [data-tab]")
               .last()
            tabNav.after(
               `<a class="item siege-nav-item" data-tab="siege" data-tooltip="${tKey("Tabs.EnginesOfWar")}"><i class="fa-solid fa-steering-wheel"></i></a>`,
            )
            html.find(".sheet-body, .tab-body").first().append(tabHtml)

            try {
               app._tabs?.[0]?.bind(html[0])
            } catch (_e) {}

            if (app._siegeActionTab === "siege") {
               if (app._tabs?.[0]) app._tabs[0].active = "siege"
               html
                  .find(".sheet-navigation .item, .tabs [data-tab]")
                  .removeClass("active")
               html.find(".siege-nav-item").addClass("active")
               html
                  .find(".sheet-body .tab, .tab-body .tab")
                  .removeClass("active")
               html.find(".siege-tab").addClass("active")
            }

            this._restoreScroll(app, html)

            this.bindListeners(app, item, html, flags)
         },
      )
   }

   static _normalizeFlags(raw) {
      
      let requiredRanks = []
      if (Array.isArray(raw.requiredRanks)) requiredRanks = raw.requiredRanks
      else if (raw.requiredRank) requiredRanks = [raw.requiredRank]
      const ammoSlugs = []
      const addAmmoSlug = (value) => {
         const slug = slugify(value)
         if (slug && !ammoSlugs.includes(slug)) ammoSlugs.push(slug)
      }
      if (Array.isArray(raw.ammoSlugs)) raw.ammoSlugs.forEach(addAmmoSlug)
      addAmmoSlug(raw.ammoSlug)
      return {
         crewAccess: Array.isArray(raw.crewAccess) ? raw.crewAccess : [],
         requiredRanks,
         prerequisites: Array.isArray(raw.prerequisites)
            ? raw.prerequisites.map((p) =>
                 typeof p === "string" ? { name: p, count: 1 } : p,
              )
            : [],
         effectDuration: raw.effectDuration ?? 1,
         effectExpiry: raw.effectExpiry || "turn-start",
         takeAmmoFromAdjacent: raw.takeAmmoFromAdjacent || false,
         loadActionsRequired: raw.loadActionsRequired || 0,
         needsIgnition: raw.needsIgnition !== false,
         rollOptions: raw.rollOptions || "",
         traits: raw.traits || "",
         skills: raw.skills || [],
         isAttack: raw.isAttack || false,
         isStrike: raw.isStrike || false,
         usesAmmunition: raw.usesAmmunition ?? true,
         ammoSlug: raw.ammoSlug || ammoSlugs[0] || "",
         ammoSlugs,
         maxLoaded: raw.maxLoaded || "",
         spend: raw.spend || "",
         proficiencies: Array.isArray(raw.proficiencies)
            ? raw.proficiencies
            : [{ name: raw.weaponProficiency || "martial", loreName: "" }],
         attackBonus: raw.attackBonus || 0,
         damageParts: Array.isArray(raw.damageParts)
            ? raw.damageParts
            : [{ ...DEFAULT_DAMAGE_PART }],
         actionType: raw.actionType || "",
         isRanged: raw.isRanged ?? true,
         blindRange: raw.blindRange || "",
         minRange: raw.minRange || "",
         rangeIncrement: raw.rangeIncrement || "",
         maxRange: raw.maxRange || "",
         subjectToMAP: raw.subjectToMAP === undefined ? true : raw.subjectToMAP,
         areaSize: raw.areaSize || 5,
         areaType: raw.areaType || "burst",
         saveDC: raw.saveDC || 10,
         saveDCPaths: Array.isArray(raw.saveDCPaths)
            ? raw.saveDCPaths
            : raw.saveDC != null && raw.saveDC !== ""
              ? [String(raw.saveDC)]
              : [],
         unlimitedDuration: raw.unlimitedDuration || false,
         removePrereqsOnUse: raw.removePrereqsOnUse ?? true,
      }
   }

   static _normalizeLoreName(value) {
      const raw = String(value || "")
         .trim()
         .replace(/\s+lore$/i, "")
         .replace(/-lore$/i, "")
      const base = slugify(raw)
      return base ? `${base}-lore` : ""
   }

   static _loreInputValue(value) {
      const base = String(value || "")
         .replace(/-lore$/i, "")
         .replace(/-/g, " ")
         .trim()
      return base
         .split(/\s+/)
         .filter(Boolean)
         .map((w) => capitalize(w))
         .join(" ")
   }

   static _scrollCandidates(app, html) {
      const root = app.element || html?.[0]
      return [
         html.closest(".window-content")[0],
         root?.querySelector?.(".window-content"),
         html.find(".sheet-body")[0],
         root?.querySelector?.(".sheet-body"),
         html[0],
      ].filter(Boolean)
   }

   static _captureScroll(app, html) {
      const candidates = this._scrollCandidates(app, html)
      app._siegeScrollPos = Math.max(
         0,
         ...candidates.map((el) => Number(el.scrollTop) || 0),
      )
   }

   static _restoreScroll(app, html) {
      if (app._siegeScrollPos == null) return
      const restore = () => {
         for (const el of this._scrollCandidates(app, html))
            el.scrollTop = app._siegeScrollPos
      }
      restore()
      requestAnimationFrame(restore)
      setTimeout(restore, 0)
      setTimeout(restore, 100)
   }

   static _buildTemplateData(item, flags) {
      const enrichedSkills = flags.skills.map((s, i) => ({
         ...s,
         index: i,
         isLore: s.name === "lore",
         loreInput: this._loreInputValue(s.loreName),
         skillOptions: ["lore", "", ...PF2E_SKILLS].map((sk) => ({
            value: sk,
            label:
               sk === ""
                  ? "──────────"
                  : sk === "lore"
                    ? tKey("Skills.Lore")
                    : capitalize(sk),
            selected: sk === s.name,
            disabled: sk === "",
         })),
      }))

      const enrichedProficiencies = flags.proficiencies.map((p, i) => ({
         ...p,
         index: i,
         isLore: p.name === "lore",
         loreInput: this._loreInputValue(p.loreName),
         weaponOptions: WEAPON_PROFS.map((wp) => ({
            value: wp,
            label: tKey("Skills.WeaponSuffix", { name: capitalize(wp) }),
            selected: wp === p.name,
         })),
         skillOptions: ["lore", ...PF2E_SKILLS].map((sk) => ({
            value: sk,
            label: sk === "lore" ? tKey("Skills.Lore") : capitalize(sk),
            selected: sk === p.name,
         })),
      }))

      const enrichedDamageParts = flags.damageParts.map((dp, i) => ({
         ...dp,
         index: i,
         dieOptions: DIE_SIZES.map((d) => ({
            value: d,
            selected: d === dp.die,
         })),
         typeOptions: PF2E_DAMAGE_TYPES.map((t) => ({
            value: t,
            label: capitalize(t),
            selected: t === dp.type,
         })),
         categoryOptions: DAMAGE_CATEGORIES.map((c) => ({
            value: c,
            label: capitalize(c),
            selected: c === dp.category,
         })),
      }))

      const vehicleCrew = item.parent.getFlag(MODULE_ID, "crew") || []
      const availableCrew = vehicleCrew.filter(
         (c) => !flags.crewAccess.includes(c.title),
      )

      const ammoTypes = item.parent.getFlag(MODULE_ID, "ammunitionTypes") || []
      const selectedAmmo = new Set(flags.ammoSlugs)
      const ammoOptions = ammoTypes.filter((t) => {
         const sl = slugify(t.slug || t.name)
         return sl && !selectedAmmo.has(sl)
      }).map((t) => {
         const sl = slugify(t.slug || t.name)
         return { value: sl, label: t.name }
      })
      const selectedAmmoBadges = flags.ammoSlugs.map((slug) => {
         const found = ammoTypes.find((t) => slugify(t.slug || t.name) === slug)
         return { value: slug, label: found?.name || slug }
      })

      
      
      const ranksEnabled = !!item.parent.getFlag(MODULE_ID, "ranksEnabled")
      const vehicleRanks = item.parent.getFlag(MODULE_ID, "ranks") || []
      const labelFor = (r) => (r.abbr ? `${r.name} (${r.abbr})` : r.name)
      const availableRanks = vehicleRanks
         .filter((r) => !flags.requiredRanks.includes(r.name))
         .map((r) => ({ value: r.name, label: labelFor(r) }))
      const requiredRankBadges = flags.requiredRanks.map((name) => {
         const r = vehicleRanks.find((x) => x.name === name)
         return { value: name, label: r ? labelFor(r) : name }
      })

      const traits = item.parent.system.traits?.value || []
      const basePrereqs = traits.includes("portable") ? ["Lifted"] : []
      const loadActionName = tKey("ActionTemplates.Load.Name")
      const availablePrereqs = [
         ...basePrereqs,
         ...item.parent.items
            .filter((i) => {
               if (i.type !== "action" || i.id === item.id) return false
               if (i.name === loadActionName || i.name === "Loading")
                  return false
               const f = i.getFlag(MODULE_ID, "siegeAction")
               if (f && (f.isStrike || f.isAttack)) return false
               return true
            })
            .map((i) => i.name),
      ].filter((name) => !flags.prerequisites.some((p) => p.name === name))

      const storedPrereqs = flags.prerequisites.map((p, i) => ({
         ...p,
         index: i,
         showCount: p.name !== "Lifted",
         removable: true,
      }))
      const isAmmoAttack =
         (flags.isStrike || flags.isAttack) && flags.usesAmmunition !== false
      const enrichedPrereqs = isAmmoAttack
         ? [
              {
                 name: tKey("AttackTemplates.Loaded.Name"),
                 showCount: false,
                 removable: false,
              },
              ...storedPrereqs,
           ]
         : storedPrereqs

      const isLoadName = item.name === tKey("ActionTemplates.Load.Name")
      const isLoadingAction = isLoadName || item.name === "Loading"

      return {
         moduleId: MODULE_ID,
         flags,
         vehicleNeedsIgnition:
            item.parent.getFlag(MODULE_ID, "needsIgnition") === true,
         availableCrew,
         availablePrereqs,
         enrichedPrereqs,
         isLoadingAction,
         hideEffectDuration:
            isLoadingAction || flags.isAttack || flags.isStrike,
         expiryStartSelected: flags.effectExpiry === "turn-start",
         expiryEndSelected: flags.effectExpiry === "turn-end",
         ammoOptions,
         selectedAmmoBadges,
         availableRanks,
         requiredRankBadges,
         saveDCPresets: [
            { value: "@skills.athletics.dc.value", label: "Athletics DC" },
            { value: "@skills.crafting.dc.value", label: "Crafting DC" },
            {
               value: "@skills.combat-vehicles-lore.dc.value",
               label: "Combat Vehicles Lore DC",
            },
            { value: "@skills.artillery-lore.dc.value", label: "Artillery Lore DC" },
            { value: "@attributes.classDC.value", label: "Class DC" },
            { value: "@abilities.str.dc", label: "Strength DC" },
            { value: "@abilities.dex.dc", label: "Dexterity DC" },
            {
               value: "min(@skills.combat-vehicles-lore.dc.value + 10, 20)",
               label: "Combat Vehicles Lore + 10 (cap 20)",
            },
         ],
         ranksEnabled,
         enrichedSkills,
         enrichedDamageParts,
         enrichedProficiencies,
         showAttackHtml: flags.isAttack || flags.isStrike,
         showAbilityAttackHtml: flags.isAttack && !flags.isStrike,
         showDamageSection:
            (flags.isStrike || (flags.isAttack && !flags.isStrike)) &&
            !isAmmoAttack,
         showAreaSettings:
            flags.actionType === "area-fire" || flags.actionType === "auto-fire",
         showSaveDCSettings:
            flags.actionType === "area-fire" ||
            flags.actionType === "auto-fire" ||
            flags.actionType === "save-single",
         showDamageSettings:
            !isAmmoAttack &&
            (flags.isStrike ||
               flags.actionType === "area-fire" ||
               flags.actionType === "auto-fire" ||
               flags.actionType === "save-single"),
         proficiencyOptions: WEAPON_PROFS.map((wp) => ({
            value: wp,
            label: tKey("Skills.WeaponSuffix", { name: capitalize(wp) }),
            selected: flags.weaponProficiency === wp,
         })),
         actionTypeOptions: [
            ...(flags.isAttack && !flags.isStrike
               ? []
               : [
                    {
                       value: "",
                       label: tKey("ActionTab.StandardAbility"),
                       selected: !flags.actionType,
                    },
                 ]),
            ...ACTION_TYPE_OPTIONS_BASE.map((o) => ({
               value: o.value,
               label: tKey(o.labelKey),
               selected: flags.actionType === o.value,
            })),
         ],
         areaTypeOptions: AREA_TYPES.map((t) => ({
            value: t,
            selected: flags.areaType === t,
         })),
         i18n: {
            crewAccess: tKey("ActionTab.CrewAccess"),
            requiredRank: tKey("ActionTab.RequiredRank"),
            addRank: tKey("ActionTab.AddRank"),
            addPosition: tKey("ActionTab.AddPosition"),
            prerequisites: tKey("ActionTab.Prerequisites"),
            requireAction: tKey("ActionTab.RequireAction"),
            removeOnUse: tKey("ActionTab.RemoveOnUse"),
            rollOptions: tKey("ActionTab.RollOptions"),
            traits: tKey("ActionTab.Traits"),
            loadActionsRequired: tKey("ActionTab.LoadActionsRequired"),
            loadActionsRequiredHint: tKey("ActionTab.LoadActionsRequiredHint"),
            needsIgnition: tKey("ActionTab.NeedsIgnition"),
            needsIgnitionHint: tKey("ActionTab.NeedsIgnitionHint"),
            effectDuration: tKey("ActionTab.EffectDuration"),
            effectExpiry: tKey("ActionTab.EffectExpiry"),
            turnStart: tKey("ActionTab.TurnStart"),
            turnEnd: tKey("ActionTab.TurnEnd"),
            unlimited: tKey("ActionTab.Unlimited"),
            usesAmmunition: tKey("ActionTab.UsesAmmunition"),
            ammunitionType: tKey("ActionTab.AmmunitionType"),
            maxLoaded: tKey("ActionTab.MaxLoaded"),
            selectAmmunition: tKey("ActionTab.SelectAmmunition"),
            spend: tKey("ActionTab.Spend"),
            proficiencies: tKey("ActionTab.Proficiencies"),
            addAnother: tKey("ActionTab.AddAnother"),
            weaponProficiencies: tKey("ActionTab.WeaponProficiencies"),
            skills: tKey("ActionTab.Skills"),
            siegeBaseAttackBonus: tKey("ActionTab.SiegeBaseAttackBonus"),
            isRangedAttack: tKey("ActionTab.IsRangedAttack"),
            blindRange: tKey("ActionTab.BlindRange"),
            minRangeVolley: tKey("ActionTab.MinRangeVolley"),
            rangeIncrement: tKey("ActionTab.RangeIncrement"),
            maxRange: tKey("ActionTab.MaxRange"),
            subjectToMAP: tKey("ActionTab.SubjectToMAP"),
            attackActionType: tKey("ActionTab.AttackActionType"),
            areaFeet: tKey("ActionTab.AreaFeet"),
            saveDC: tKey("ActionTab.SaveDC"),
            saveDCHint: tKey("ActionTab.SaveDCHint"),
            saveDCPlaceholder: tKey("ActionTab.SaveDCPlaceholder"),
            damageInstances: tKey("ActionTab.DamageInstances"),
            addDamageInstance: tKey("ActionTab.AddDamageInstance"),
            requiredSkills: tKey("ActionTab.RequiredSkills"),
            addSkill: tKey("ActionTab.AddSkill"),
            levelBasedDC: tKey("ActionTab.LevelBasedDC"),
            lorePlaceholder: tKey("ActionTab.LorePlaceholder"),
         },
      }
   }

   static bindListeners(app, item, html, flags) {
      const saveFlags = async (render = false) => {
         await item.update(
            { [`flags.${MODULE_ID}.siegeAction`]: flags },
            render ? {} : { render: false },
         )
      }

      const setFlagWithScroll = async () => {
         this._captureScroll(app, html)
         await item.update({ [`flags.${MODULE_ID}.siegeAction`]: flags })
      }

      html.find("[data-action-path]").on("change", async (e) => {
         const el = e.currentTarget
         const path = el.dataset.actionPath
         let value
         if (el.type === "checkbox") value = el.checked
         else if (el.type === "number") value = Number(el.value) || 0
         else value = el.value
         flags[path] = value
         if (path === "usesAmmunition") await setFlagWithScroll()
         else await saveFlags()
      })

      const setSectionVisible = (selector, visible) => {
         const section = html.find(selector)
         section.css("display", visible ? "" : "none")
      }

      const toggleSection = (cbSelector, sectionSelector) =>
         html.find(cbSelector).on("change", (e) => {
            setSectionVisible(sectionSelector, e.target.checked)
         })

      toggleSection(".siege-is-ranged-cb", ".siege-ranged-settings")
      toggleSection(".siege-uses-ammo-cb", ".siege-ammo-settings")

      html.find(".siege-unlimited-cb").on("change", (e) => {
         html.find(".siege-effect-duration").prop("disabled", e.target.checked)
      })

      html.find(".siege-action-type-select").on("change", (e) => {
         const val = $(e.currentTarget).val()
         const isArea = val === "area-fire" || val === "auto-fire"
         const isSave = isArea || val === "save-single"
         setSectionVisible(".siege-area-settings", isArea)
         setSectionVisible(".siege-save-settings", isSave)
         setSectionVisible(".siege-damage-settings", isSave)
      })

      html.find(".add-crew-access-select").on("change", async (e) => {
         const val = $(e.currentTarget).val()
         if (!val) return
         if (!flags.crewAccess.includes(val)) flags.crewAccess.push(val)
         await setFlagWithScroll()
      })

      html.find(".add-required-rank-select").on("change", async (e) => {
         const val = $(e.currentTarget).val()
         if (!val) return
         flags.requiredRanks = flags.requiredRanks || []
         if (!flags.requiredRanks.includes(val)) flags.requiredRanks.push(val)
         await setFlagWithScroll()
      })

      html.find(".add-action-ammo-select").on("change", async (e) => {
         const val = slugify($(e.currentTarget).val())
         if (!val) return
         flags.ammoSlugs = flags.ammoSlugs || []
         if (!flags.ammoSlugs.includes(val)) flags.ammoSlugs.push(val)
         if (!flags.ammoSlug) flags.ammoSlug = flags.ammoSlugs[0] || ""
         await setFlagWithScroll()
      })

      html.find(".remove-action-ammo").on("click", async (e) => {
         e.preventDefault()
         const slug = slugify($(e.currentTarget).data("slug"))
         flags.ammoSlugs = (flags.ammoSlugs || []).filter((s) => s !== slug)
         flags.ammoSlug = flags.ammoSlugs[0] || ""
         await setFlagWithScroll()
      })

      html.find(".remove-required-rank").on("click", async (e) => {
         const rank = $(e.currentTarget).data("rank")
         flags.requiredRanks = (flags.requiredRanks || []).filter(
            (r) => r !== String(rank),
         )
         await setFlagWithScroll()
      })

      
      html.find(".add-savedc-path").on("click", async (e) => {
         e.preventDefault()
         const input = $(e.currentTarget).siblings(".siege-savedc-input")
         const val = (input.val() || "").trim()
         if (!val) return
         flags.saveDCPaths = flags.saveDCPaths || []
         flags.saveDCPaths.push(val)
         await setFlagWithScroll()
      })

      html.find(".siege-savedc-input").on("keydown", async (e) => {
         if (e.key !== "Enter") return
         e.preventDefault()
         const val = ($(e.currentTarget).val() || "").trim()
         if (!val) return
         flags.saveDCPaths = flags.saveDCPaths || []
         flags.saveDCPaths.push(val)
         await setFlagWithScroll()
      })

      html.find(".remove-savedc-path").on("click", async (e) => {
         const idx = $(e.currentTarget).data("index")
         flags.saveDCPaths = flags.saveDCPaths || []
         flags.saveDCPaths.splice(idx, 1)
         await setFlagWithScroll()
      })

      html.find(".remove-crew-access").on("click", async (e) => {
         const idx = $(e.currentTarget).data("index")
         flags.crewAccess.splice(idx, 1)
         await setFlagWithScroll()
      })

      html.find(".add-prereq-select").on("change", async (e) => {
         const val = $(e.currentTarget).val()
         if (!val) return
         if (!flags.prerequisites.some((p) => p.name === val))
            flags.prerequisites.push({ name: val, count: 1 })
         await setFlagWithScroll()
      })

      html.find(".remove-prereq").on("click", async (e) => {
         const idx = $(e.currentTarget).data("index")
         flags.prerequisites.splice(idx, 1)
         await setFlagWithScroll()
      })

      html.find(".prereq-count-input").on("change", async (e) => {
         const el = $(e.currentTarget)
         const idx = el.data("index")
         let val = parseInt(el.val()) || 1
         if (val < 1) val = 1
         flags.prerequisites[idx].count = val
         await saveFlags()
      })

      html.find(".add-skill").on("click", async (e) => {
         e.preventDefault()
         flags.skills.push({ name: "athletics", loreName: "", dc: "" })
         await setFlagWithScroll()
      })

      html.find(".remove-skill").on("click", async (e) => {
         e.preventDefault()
         const confirmed = await foundry.applications.api.DialogV2.confirm({
            classes: ["siege-v2-dialog"],
            window: { title: tKey("ActionTab.RemoveSkill") },
            content: `<p>${tKey("ActionTab.RemoveSkillConfirm")}</p>`,
            rejectClose: false,
         })
         if (!confirmed) return
         const idx = $(e.currentTarget).closest(".siege-skill-row").data("index")
         flags.skills.splice(idx, 1)
         await setFlagWithScroll()
      })

      html
         .find(".skill-name, .lore-name, .skill-dc")
         .on("change", async (e) => {
            const row = $(e.currentTarget).closest(".siege-skill-row")
            const idx = row.data("index")
            const dcVal = String(row.find(".skill-dc").val() ?? "").trim()
            const isLore = row.find(".skill-name").val() === "lore"

            row.find(".lore-name").toggle(isLore)

            flags.skills[idx] = {
               name: row.find(".skill-name").val(),
               loreName: isLore
                  ? this._normalizeLoreName(row.find(".lore-name").val())
                  : "",
               dc: dcVal,
            }
            await saveFlags()
         })

      html.find(".add-damage-part").on("click", async (e) => {
         e.preventDefault()
         flags.damageParts.push({ ...DEFAULT_DAMAGE_PART })
         await setFlagWithScroll()
      })

      html.find(".add-prof").on("click", async (e) => {
         e.preventDefault()
         flags.proficiencies.push({ name: "martial", loreName: "" })
         await setFlagWithScroll()
      })

      html.find(".remove-prof").on("click", async (e) => {
         e.preventDefault()
         if (flags.proficiencies.length <= 1)
            return ui.notifications.warn(
               tKey("Notifications.MustHaveOneProficiency"),
            )
         const idx = $(e.currentTarget).closest(".prof-row").data("index")
         flags.proficiencies.splice(idx, 1)
         await setFlagWithScroll()
      })

      html.find(".prof-name, .prof-lore-name").on("change", async (e) => {
         const row = $(e.currentTarget).closest(".prof-row")
         const idx = row.data("index")
         const isLore = row.find(".prof-name").val() === "lore"
         row.find(".prof-lore-name").toggle(isLore)
         flags.proficiencies[idx] = {
            name: row.find(".prof-name").val(),
            loreName: isLore
               ? this._normalizeLoreName(row.find(".prof-lore-name").val())
               : "",
         }
         await saveFlags()
      })

      html.find(".remove-damage-part").on("click", async (e) => {
         e.preventDefault()
         const confirmed = await foundry.applications.api.DialogV2.confirm({
            classes: ["siege-v2-dialog"],
            window: { title: tKey("ActionTab.RemoveDamagePart") },
            content: `<p>${tKey("ActionTab.RemoveDamageConfirm")}</p>`,
            rejectClose: false,
         })
         if (!confirmed) return
         const idx = $(e.currentTarget).closest(".damage-part-row").data("index")
         flags.damageParts.splice(idx, 1)
         await setFlagWithScroll()
      })

      html
         .find(".dp-dice, .dp-die, .dp-type, .dp-category")
         .on("change", async (e) => {
            const row = $(e.currentTarget).closest(".damage-part-row")
            const idx = row.data("index")
            flags.damageParts[idx] = {
               dice: parseInt(row.find(".dp-dice").val()) || 0,
               die: row.find(".dp-die").val(),
               type: row.find(".dp-type").val(),
               category: row.find(".dp-category").val(),
            }
            await saveFlags()
         })
   }
}
