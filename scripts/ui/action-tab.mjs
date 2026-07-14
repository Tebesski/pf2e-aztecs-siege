import {
   MODULE_ID,
   PF2E_SKILLS,
   WEAPON_PROFS,
   AREA_TYPES,
} from "../constants.mjs"
import { slugify, renderHbs, tplPath, capitalize, tKey } from "../utils.mjs"
import { SiegeSettings } from "../managers/settings.mjs"
import {
   DEFAULT_DAMAGE_PART,
   enrichConsequences,
   enrichDamageParts,
   normalizeConsequences,
} from "./action-tab/consequences.mjs"
import {
   bindActionTabListeners,
   refreshConsequenceValidations,
} from "./action-tab/listeners.mjs"

const ACTION_TYPE_OPTIONS_BASE = [
   { value: "area-fire", labelKey: "ActionTab.AreaFire" },
   { value: "auto-fire", labelKey: "ActionTab.AutoFire" },
   { value: "save-single", labelKey: "ActionTab.SingleTarget" },
]

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

            bindActionTabListeners(this, app, item, html, flags)
            refreshConsequenceValidations(html)
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
      const hasComponentFlag = Object.prototype.hasOwnProperty.call(raw, "isComponent")
      const isComponent =
         raw.isComponent === true ||
         raw.isComponent === "true" ||
         raw.isComponent === 1 ||
         raw.isComponent === "1" ||
         (!hasComponentFlag && !!raw.componentType)
      const usesAmmunition =
         raw.usesAmmunition === false ||
         raw.usesAmmunition === "false" ||
         raw.usesAmmunition === 0 ||
         raw.usesAmmunition === "0"
            ? false
            : true
      const isAttack = raw.isAttack || false
      const isStrike = raw.isStrike || false
      const isAmmoAttack = (isAttack || isStrike) && usesAmmunition
      const rawLoadActions = parseInt(raw.loadActionsRequired)
      const loadActionsRequired = isAmmoAttack
         ? Math.max(1, Number.isFinite(rawLoadActions) ? rawLoadActions : 1)
         : Math.max(0, Number.isFinite(rawLoadActions) ? rawLoadActions : 0)
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
         loadActionsRequired,
         needsIgnition: raw.needsIgnition !== false,
         rollOptions: raw.rollOptions || "",
         traits: raw.traits || "",
         skills: raw.skills || [],
         isAttack,
         isStrike,
         usesAmmunition,
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
         consequences: normalizeConsequences(raw.consequences),
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
         isComponent,
         componentType: raw.componentType || "",
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
      const root =
         app.element instanceof HTMLElement
            ? app.element
            : app.element?.[0] || html?.[0] || null
      const found = [
         html.closest(".window-content")[0],
         root?.querySelector?.(".window-content"),
         root?.querySelector?.(".sheet-content"),
         html.find(".sheet-body")[0],
         root?.querySelector?.(".sheet-body"),
         html.find(".tab.active")[0],
         root?.querySelector?.(".tab.active"),
         html.find('.tab[data-tab="siege"]')[0],
         root?.querySelector?.('.tab[data-tab="siege"]'),
         html.find(".siege-tab")[0],
         root?.querySelector?.(".siege-tab"),
         html[0],
      ].filter(Boolean)
      return [...new Set(found)].filter(
         (el) => typeof el.scrollTop === "number",
      )
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
                  ? tKey("ActionTab.SkillSeparator")
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

      const enrichedDamageParts = enrichDamageParts(flags.damageParts)
      const enrichedConsequences = enrichConsequences(flags)

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
      const enrichedPrereqs = isAmmoAttack && flags.loadActionsRequired > 1
         ? [
              {
                 name: tKey("AttackTemplates.Loaded.Name"),
                 showCount: false,
                 displayCount: flags.loadActionsRequired,
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
         loadActionsMin: isAmmoAttack ? 1 : 0,
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
            {
               value: "@skills.athletics.dc.value",
               label: tKey("ActionTab.SaveDCPreset.Athletics"),
            },
            {
               value: "@skills.crafting.dc.value",
               label: tKey("ActionTab.SaveDCPreset.Crafting"),
            },
            {
               value: "@skills.combat-vehicles-lore.dc.value",
               label: tKey("ActionTab.SaveDCPreset.CombatVehiclesLore"),
            },
            {
               value: "@skills.artillery-lore.dc.value",
               label: tKey("ActionTab.SaveDCPreset.ArtilleryLore"),
            },
            {
               value: "@attributes.classDC.value",
               label: tKey("ActionTab.SaveDCPreset.Class"),
            },
            {
               value: "@abilities.str.dc",
               label: tKey("ActionTab.SaveDCPreset.Strength"),
            },
            {
               value: "@abilities.dex.dc",
               label: tKey("ActionTab.SaveDCPreset.Dexterity"),
            },
            {
               value: "min(@skills.combat-vehicles-lore.dc.value + 10, 20)",
               label: tKey("ActionTab.SaveDCPreset.CombatVehiclesLoreCap"),
            },
         ],
         ranksEnabled,
         enrichedSkills,
         enrichedDamageParts,
         enrichedConsequences,
         enrichedProficiencies,
         allCrewAccess: flags.crewAccess.length === 0,
         showAttackHtml: flags.isAttack || flags.isStrike,
         showAbilityAttackHtml: flags.isAttack && !flags.isStrike,
         showRequiredSkillsSection: !flags.isStrike,
         showDamageSection:
            flags.isStrike || (flags.isAttack && !flags.isStrike),
         showAreaSettings:
            flags.actionType === "area-fire" || flags.actionType === "auto-fire",
         showSaveDCSettings:
            flags.actionType === "area-fire" ||
            flags.actionType === "auto-fire" ||
            flags.actionType === "save-single",
         showDamageSettings:
            flags.isStrike ||
               flags.actionType === "area-fire" ||
               flags.actionType === "auto-fire" ||
               flags.actionType === "save-single",
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
         componentTypeOptions: SiegeSettings.moduleTypes().map((type) => ({
            value: type,
            selected: flags.componentType === type,
         })),
         i18n: {
            isComponent: tKey("ActionTab.IsComponent"),
            componentType: tKey("ActionTab.ComponentType"),
            selectComponentType: tKey("Misc.Select"),
            crewAccess: tKey("ActionTab.CrewAccess"),
            all: tKey("Misc.All"),
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
            selectAmmunition: tKey("Misc.Select"),
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
            damageInstances: tKey("ActionTab.DamageInstances"),
            addDamageInstance: tKey("ActionTab.AddDamageInstance"),
            requiredSkills: tKey("ActionTab.RequiredSkills"),
            addSkill: tKey("ActionTab.AddSkill"),
            consequences: tKey("ActionTab.Consequences"),
            addConsequence: tKey("ActionTab.AddConsequence"),
            savingThrowConsequences: tKey("ActionTab.SavingThrowConsequences"),
            addSavingThrowConsequence: tKey("ActionTab.AddSavingThrowConsequence"),
            degreeOfSuccess: tKey("ActionTab.DegreeOfSuccess"),
            consequenceType: tKey("ActionTab.ConsequenceType"),
            condition: tKey("ActionTab.Condition"),
            value: tKey("ActionTab.Value"),
            duration: tKey("ActionTab.Duration"),
            applyTo: tKey("ActionTab.ApplyTo"),
            save: tKey("ActionTab.Save"),
            isBasic: tKey("ActionTab.IsBasic"),
            basicDamage: tKey("ActionTab.BasicDamage"),
            uuid: tKey("ActionTab.UUID"),
            ruleElement: tKey("ActionTab.RuleElement"),
            validRuleElement: tKey("ActionTab.ValidRuleElement"),
            invalidRuleElement: tKey("ActionTab.InvalidRuleElement"),
            addHealInstance: tKey("ActionTab.AddHealInstance"),
            levelBasedDC: tKey("ActionTab.LevelBasedDC"),
            lorePlaceholder: tKey("ActionTab.LorePlaceholder"),
         },
      }
   }


}
