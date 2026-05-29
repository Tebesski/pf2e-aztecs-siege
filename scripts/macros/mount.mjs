import {
   MODULE_ID,
   DEFAULT_PERSON_IMG,
   DEFAULT_LIFTED_IMG,
} from "../constants.mjs"
import {
   slugify,
   isSiege,
   validImg,
   renderHbs,
   tplPath,
   tKey,
   countOccupants,
   buildStrikeRules,
   getCostGlyph,
} from "../utils.mjs"
import { AmmunitionManager } from "../managers/ammunition.mjs"
import { SiegeCrewManager } from "../managers/crew.mjs"
import { SiegePortableManager } from "../managers/portable.mjs"
import { getActionsForCrew, ensureSiegeCSS } from "./helpers.mjs"

export async function mountMacro(crewmanActor = null, siegeActor = null) {
   let crewman = crewmanActor
   let siege = siegeActor

   if (!crewman || !siege) {
      const controlled = canvas.tokens.controlled
      const targets = Array.from(game.user.targets)
      if (controlled.length !== 1 || targets.length !== 1)
         return ui.notifications.warn(
            tKey("Notifications.SelectOneCrewmanOneSiege"),
         )
      crewman = controlled[0].actor
      siege = targets[0].actor
   }

   if (!isSiege(siege))
      return ui.notifications.warn(tKey("Notifications.MustBeSiegeWeapon"))

   const existing = crewman.itemTypes.effect.find(
      (e) => e.getFlag(MODULE_ID, "siegeId") === siege.id,
   )
   if (existing) {
      await SiegeCrewManager.dismountCrewman(crewman, siege)
      ui.notifications.info(
         tKey("Notifications.CrewmanDismounted", {
            crewman: crewman.name,
            siege: siege.name,
         }),
      )
      return
   }

   const crewPositions = siege.getFlag(MODULE_ID, "crew") || []
   if (crewPositions.length === 0)
      return ui.notifications.warn(tKey("Notifications.NoCrewPositions"))

   const positionsData = await buildPositionsData(siege, crewPositions)
   const htmlContent = await renderHbs(tplPath("macros/mount.hbs"), {
      positions: positionsData,
      i18n: {
         mountAs: tKey("Buttons.Confirm"),
      },
   })

   class SiegeMountApp extends foundry.applications.api.ApplicationV2 {
      static DEFAULT_OPTIONS = {
         window: { title: tKey("Mount.Title", { name: siege.name }) },
         position: { width: 450, height: "auto" },
      }

      constructor(options) {
         super(options)
         ensureSiegeCSS()
      }

      _renderHTML() {
         return htmlContent
      }
      _replaceHTML(result, content) {
         content.innerHTML = result
      }
      _onRender() {
         $(this.element)
            .find(".mount-btn")
            .on("click", (e) =>
               handleMountClick(e, this, crewman, siege, crewPositions),
            )
      }
   }

   new SiegeMountApp().render(true)
}

async function buildPositionsData(siege, crewPositions) {
   const ammoTypes = siege.getFlag(MODULE_ID, "ammunitionTypes") || []
   const actions = siege.items.filter((a) => a.type === "action")

   return crewPositions.map((pos) => {
      const currentOccupants = countOccupants(siege, pos.title)
      const minReq = parseInt(pos.min) || 1
      const maxCap = parseInt(pos.max) || 1
      const isMet = currentOccupants >= minReq

      const posActions = actions
         .filter((a) => {
            const flag = a.getFlag(MODULE_ID, "siegeAction")
            return (
               flag &&
               (!flag.crewAccess ||
                  flag.crewAccess.length === 0 ||
                  flag.crewAccess.includes(pos.title))
            )
         })
         .map((a) => buildActionRow(a, ammoTypes))

      return {
         title: pos.title,
         icon: pos.icon || DEFAULT_PERSON_IMG,
         currentOccupants,
         minReq,
         maxCap,
         isMet,
         actions: posActions,
         mountLabel: tKey("Mount.MountAs", { position: pos.title }),
      }
   })
}

function buildActionRow(a, ammoTypes) {
   const flag = a.getFlag(MODULE_ID, "siegeAction") || {}
   let ammoName = null
   if (flag.usesAmmunition !== false && flag.ammoSlug) {
      const found = ammoTypes.find(
         (t) => slugify(t.slug || t.name) === flag.ammoSlug,
      )
      ammoName = found ? found.name : flag.ammoSlug
   }

   const profs = flag.proficiencies || [
      { name: flag.weaponProficiency || "martial", loreName: "" },
   ]
   const profString = profs
      .map((p) => {
         if (p.name === "lore") {
            if (!p.loreName) return tKey("Skills.Lore")
            const clean = p.loreName.replace(/-lore$/i, "").replace(/-/g, " ")
            const titled = clean.replace(/\b\w/g, (c) => c.toUpperCase())
            return tKey("Skills.LoreSuffix", { name: titled })
         }
         const cap = p.name.charAt(0).toUpperCase() + p.name.slice(1)
         const suffix = ["unarmed", "simple", "martial", "advanced"].includes(
            p.name,
         )
            ? tKey("Skills.WeaponSuffix", { name: cap })
            : cap
         return suffix
      })
      .join(", ")

   return {
      name: a.name,
      img: a.img || "icons/svg/item-bag.svg",
      description: a.system.description.value,
      costGlyph: getCostGlyph(a),
      flag,
      ammoName,
      spend: parseInt(flag.spend) || 1,
      isAttack: flag.isAttack || flag.isStrike,
      isStrike: flag.isStrike,
      isAbility: flag.isAttack && !flag.isStrike,
      isRanged: flag.isRanged !== false,
      prereqs:
         flag.prerequisites && flag.prerequisites.length > 0
            ? flag.prerequisites.map((p) => p.name).join(", ")
            : tKey("Misc.None"),
      damageString: (flag.damageParts || [])
         .map(
            (dp) =>
               `${dp.dice}${dp.die === "-" ? "" : dp.die} ${dp.type} (${dp.category})`,
         )
         .join(", "),
      profString,
   }
}

async function handleMountClick(e, app, crewman, siege, crewPositions) {
   e.preventDefault()
   const chosenPosition = $(e.currentTarget).data("position")
   const posData = crewPositions.find((p) => p.title === chosenPosition)
   const maxAllowed = parseInt(posData?.max) || 1
   const currentOccupants = countOccupants(siege, chosenPosition)

   if (currentOccupants >= maxAllowed) {
      return ui.notifications.warn(
         tKey("Mount.PositionFull", {
            position: chosenPosition,
            max: maxAllowed,
         }),
      )
   }

   const traits = siege.system.traits?.value || []
   const isPortable = traits.includes("portable")
   let liftedBulk = 0

   if (isPortable) {
      liftedBulk = await promptForLift(crewman, siege)
      if (liftedBulk === null) return
   }

   const rules = buildAllStrikeRules(siege, chosenPosition)
   const totalBulk = parseInt(siege.getFlag(MODULE_ID, "bulk")) || 0
   const embeddedDocs = buildMountedDocs(
      siege,
      chosenPosition,
      rules,
      isPortable,
      liftedBulk,
      totalBulk,
   )

   await crewman.createEmbeddedDocuments("Item", embeddedDocs)
   ui.notifications.info(
      tKey("Notifications.CrewmanMounted", {
         crewman: crewman.name,
         siege: siege.name,
         position: chosenPosition,
      }),
   )
   await SiegePortableManager.syncPortableState(siege)
   app.close()
}

function buildAllStrikeRules(siege, chosenPosition) {
   const rules = []
   const actions = siege.items.filter((a) => a.type === "action")

   for (const a of actions) {
      const flag = a.getFlag(MODULE_ID, "siegeAction")
      if (!flag || !flag.isStrike) continue
      if (
         flag.crewAccess?.length > 0 &&
         !flag.crewAccess.includes(chosenPosition)
      )
         continue

      rules.push(...buildStrikeRules(siege, { ...flag, strikeLabel: a.name }))
   }
   return rules
}

function buildMountedDocs(
   siege,
   chosenPosition,
   rules,
   isPortable,
   liftedBulk,
   totalBulk,
) {
   const docs = [
      {
         name: tKey("Markers.MountedOn", { name: siege.name }),
         type: "effect",
         img: validImg(siege.img, DEFAULT_PERSON_IMG),
         system: {
            level: { value: 1 },
            description: {
               value: tKey("Mount.MarkerDescription", {
                  siege: siege.name,
                  position: chosenPosition,
               }),
            },
            tokenIcon: { show: true },
            rules,
         },
         flags: {
            [MODULE_ID]: {
               position: chosenPosition,
               siegeId: siege.id,
               siegeUuid: siege.uuid,
            },
         },
      },
   ]

   if (isPortable) {
      docs.push(
         {
            name: tKey("Markers.LiftedItem", { name: siege.name }),
            type: "equipment",
            img: validImg(siege.img, DEFAULT_LIFTED_IMG),
            system: {
               description: { value: tKey("Markers.LiftedItemDesc") },
               bulk: { value: liftedBulk },
            },
            flags: { [MODULE_ID]: { isLiftedItem: true, siegeId: siege.id } },
         },
         {
            name: `Lifting ${siege.name}`,
            type: "effect",
            img: validImg(siege.img, DEFAULT_LIFTED_IMG),
            system: {
               level: { value: 1 },
               badge: { type: "counter", value: liftedBulk, min: 1 },
               description: {
                  value: tKey("Markers.LiftingDesc", { name: siege.name }),
               },
               tokenIcon: { show: true },
            },
            flags: {
               [MODULE_ID]: { isLiftingEffect: true, siegeId: siege.id },
            },
         },
      )
   }

   return docs
}

async function promptForLift(crewman, siege) {
   const totalBulk = siege.getFlag(MODULE_ID, "bulk") || 0
   let currentlyLifted = 0
   const lifters = []

   for (const actor of game.actors) {
      const onSiege = actor.itemTypes.effect.some(
         (e) => e.getFlag(MODULE_ID, "siegeId") === siege.id,
      )
      if (!onSiege) continue
      const liftItem = actor.items.find(
         (i) =>
            i.getFlag(MODULE_ID, "isLiftedItem") &&
            i.getFlag(MODULE_ID, "siegeId") === siege.id,
      )
      if (liftItem) {
         const bulk = liftItem.system.bulk?.value || 0
         currentlyLifted += bulk
         lifters.push(`<li>${actor.name}: ${bulk} Bulk</li>`)
      }
   }

   const capData = SiegePortableManager._getLifterCapacity(crewman, null)
   const myCapacity = capData.capacity
   const remainingBulk = Math.max(0, totalBulk - currentlyLifted)
   const inputMax = Math.min(remainingBulk, myCapacity)

   const currentLiftersLabel = tKey("Mount.CurrentLifters")
   const noneLabel = tKey("Mount.None")
   const bulkLiftedText = tKey("Mount.BulkLifted", {
      lifted: currentlyLifted,
      total: totalBulk,
   })
   const capacityText = tKey("Mount.CarryingCapacity", {
      enc: capData.encumberedAfter,
      encPlus: capData.encumberedAfter + 1,
      max: capData.maxLimit,
   })
   const bulkToLift = tKey("Mount.BulkToLift")

   const dialogContent = `
      <div class="siege-lift-dialog">
         <p>${currentLiftersLabel}</p>
         <ul>${lifters.length ? lifters.join("") : `<li>${noneLabel}</li>`}</ul>
         <p><strong id="lifted-tracker">${bulkLiftedText}</strong></p>
         <p class="siege-cap-note">${capacityText} <strong id="lift-capacity-tracker">${capData.otherBulk}</strong></p>
      </div>
      <div class="form-group">
         <label>${bulkToLift}</label>
         <input type="number" id="lift-bulk-input" value="0" min="0" max="${inputMax}">
      </div>
      <p id="lift-bulk-warn" class="siege-warn"></p>
   `

   const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: tKey("Mount.LiftTitle", { name: siege.name }) },
      position: { width: 480 },
      content: dialogContent,
      buttons: [
         {
            action: "lift",
            label: tKey("Mount.LiftAndMount"),
            icon: "fa-solid fa-hand-rock",
         },
      ],
      render: () =>
         bindLiftInput(
            currentlyLifted,
            totalBulk,
            capData,
            myCapacity,
            remainingBulk,
         ),
   })

   if (!choice) return null

   let liftedBulk =
      parseInt(document.getElementById("lift-bulk-input")?.value) || 0
   if (liftedBulk < 0) liftedBulk = 0
   if (liftedBulk > remainingBulk) liftedBulk = remainingBulk
   if (liftedBulk > myCapacity) {
      ui.notifications.warn(
         tKey("Mount.CapAtMax", { name: crewman.name, max: myCapacity }),
      )
      liftedBulk = myCapacity
   }
   return liftedBulk
}

function bindLiftInput(
   currentlyLifted,
   totalBulk,
   capData,
   myCapacity,
   remainingBulk,
) {
   const input = document.getElementById("lift-bulk-input")
   const tracker = document.getElementById("lifted-tracker")
   const warn = document.getElementById("lift-bulk-warn")
   const capTracker = document.getElementById("lift-capacity-tracker")
   if (!input) return

   input.addEventListener("input", () => {
      let val = parseInt(input.value) || 0
      if (val < 0) val = 0
      if (tracker) {
         tracker.innerText = tKey("Mount.BulkLifted", {
            lifted: currentlyLifted + val,
            total: totalBulk,
         })
      }
      if (capTracker) capTracker.innerText = capData.otherBulk + val
      if (warn) {
         if (val > myCapacity)
            warn.innerText = tKey("Mount.ExceedsCapacity", { max: myCapacity })
         else if (val > remainingBulk)
            warn.innerText = tKey("Mount.OnlyBulkLeft", { bulk: remainingBulk })
         else warn.innerText = ""
      }
   })
}
