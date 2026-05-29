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
               `<a class="item siege-nav-item" data-tab="siege">${tKey("Tabs.Siege")}</a>`,
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
                  .find(".sheet-body > .tab, .tab-body > .tab")
                  .removeClass("active")
               html.find(".siege-tab").addClass("active")
            }

            if (app._siegeScrollPos) {
               const scrollEl =
                  html.closest(".window-content")[0] ||
                  html.find(".sheet-body")[0] ||
                  html[0]
               if (scrollEl) scrollEl.scrollTop = app._siegeScrollPos
            }

            this.bindListeners(app, item, html, flags)
         },
      )
   }

   static _normalizeFlags(raw) {
      return {
         crewAccess: Array.isArray(raw.crewAccess) ? raw.crewAccess : [],
         prerequisites: Array.isArray(raw.prerequisites)
            ? raw.prerequisites.map((p) =>
                 typeof p === "string" ? { name: p, count: 1 } : p,
              )
            : [],
         effectDuration: raw.effectDuration ?? 1,
         effectExpiry: raw.effectExpiry || "turn-start",
         takeAmmoFromAdjacent: raw.takeAmmoFromAdjacent || false,
         loadThreshold: raw.loadThreshold || 1,
         rollOptions: raw.rollOptions || "",
         traits: raw.traits || "",
         skills: raw.skills || [],
         isAttack: raw.isAttack || false,
         isStrike: raw.isStrike || false,
         usesAmmunition: raw.usesAmmunition ?? true,
         ammoSlug: raw.ammoSlug || "",
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
         unlimitedDuration: raw.unlimitedDuration || false,
         removePrereqsOnUse: raw.removePrereqsOnUse ?? true,
      }
   }

   static _buildTemplateData(item, flags) {
      const enrichedSkills = flags.skills.map((s, i) => ({
         ...s,
         index: i,
         isLore: s.name === "lore",
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
      const ammoOptions = ammoTypes.map((t) => {
         const sl = slugify(t.slug || t.name)
         return { value: sl, label: t.name, selected: flags.ammoSlug === sl }
      })

      const traits = item.parent.system.traits?.value || []
      const basePrereqs = traits.includes("portable") ? ["Lifted"] : []
      const availablePrereqs = [
         ...basePrereqs,
         ...item.parent.items
            .filter((i) => {
               if (i.type !== "action" || i.id === item.id) return false
               const f = i.getFlag(MODULE_ID, "siegeAction")
               if (f && (f.isStrike || f.isAttack)) return false
               return true
            })
            .map((i) => i.name),
      ].filter((name) => !flags.prerequisites.some((p) => p.name === name))

      const enrichedPrereqs = flags.prerequisites.map((p, i) => ({
         ...p,
         index: i,
         showCount: p.name !== "Lifted",
      }))

      const isLoadName = item.name === tKey("ActionTemplates.Load.Name")
      const isLoadingAction = isLoadName || item.name === "Loading"

      return {
         moduleId: MODULE_ID,
         flags,
         availableCrew,
         availablePrereqs,
         enrichedPrereqs,
         isLoadingAction,
         hideEffectDuration:
            isLoadingAction || flags.isAttack || flags.isStrike,
         expiryStartSelected: flags.effectExpiry === "turn-start",
         expiryEndSelected: flags.effectExpiry === "turn-end",
         ammoOptions,
         enrichedSkills,
         enrichedDamageParts,
         enrichedProficiencies,
         showAttackHtml: flags.isAttack || flags.isStrike,
         showAbilityAttackHtml: flags.isAttack && !flags.isStrike,
         showDamageSection: flags.isStrike || (flags.isAttack && !flags.isStrike),
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
         i18n: {
            crewAccess: tKey("ActionTab.CrewAccess"),
            addPosition: tKey("ActionTab.AddPosition"),
            prerequisites: tKey("ActionTab.Prerequisites"),
            requireAction: tKey("ActionTab.RequireAction"),
            removeOnUse: tKey("ActionTab.RemoveOnUse"),
            rollOptions: tKey("ActionTab.RollOptions"),
            traits: tKey("ActionTab.Traits"),
            takeAmmoFromAdjacent: tKey("ActionTab.TakeAmmoFromAdjacent"),
            loadThreshold: tKey("ActionTab.LoadThreshold"),
            effectDuration: tKey("ActionTab.EffectDuration"),
            effectExpiry: tKey("ActionTab.EffectExpiry"),
            turnStart: tKey("ActionTab.TurnStart"),
            turnEnd: tKey("ActionTab.TurnEnd"),
            unlimited: tKey("ActionTab.Unlimited"),
            usesAmmunition: tKey("ActionTab.UsesAmmunition"),
            ammunitionType: tKey("ActionTab.AmmunitionType"),
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
         const scrollEl =
            html.closest(".window-content")[0] ||
            html.find(".sheet-body")[0] ||
            html[0]
         app._siegeScrollPos = scrollEl ? scrollEl.scrollTop : 0
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
         await saveFlags()
      })

      const toggleSection = (cbSelector, sectionSelector) =>
         html.find(cbSelector).on("change", (e) => {
            html.find(sectionSelector).toggle(e.target.checked)
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
         html.find(".siege-area-settings").toggle(isArea)
         html.find(".siege-save-settings").toggle(isSave)
         html.find(".siege-damage-settings").toggle(isSave)
      })

      html.find(".add-crew-access-select").on("change", async (e) => {
         const val = $(e.currentTarget).val()
         if (!val) return
         if (!flags.crewAccess.includes(val)) flags.crewAccess.push(val)
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
            const dcVal = row.find(".skill-dc").val()
            const isLore = row.find(".skill-name").val() === "lore"

            row.find(".lore-name").toggle(isLore)

            flags.skills[idx] = {
               name: row.find(".skill-name").val(),
               loreName: slugify(row.find(".lore-name").val()),
               dc: dcVal === "" ? "" : parseInt(dcVal),
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
            loreName: slugify(row.find(".prof-lore-name").val()),
         }
         await saveFlags()
      })

      html.find(".remove-damage-part").on("click", async (e) => {
         e.preventDefault()
         const confirmed = await foundry.applications.api.DialogV2.confirm({
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
