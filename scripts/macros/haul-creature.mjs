import { tKey, formatBulk } from "../utils.mjs"
import { MODULE_ID, SIZE_ELEVATION } from "../constants.mjs"
import { HaulManager } from "../managers/haul.mjs"

export async function haulCreatureMacro() {
   const haulerToken = canvas.tokens.controlled[0]
   if (!haulerToken) {
      ui.notifications.warn(tKey("Haul.Notifications.SelectHauler"))
      return
   }
   const hauler = haulerToken.actor

   const targets = [...game.user.targets]
      .map((t) => t.actor)
      .filter((a) => a && a.id !== hauler.id)
   if (targets.length === 0) {
      ui.notifications.warn(tKey("Haul.Notifications.TargetSomething"))
      return
   }

   const isVehicleActor = (a) => a?.type === "vehicle"

   const rows = targets.map((a) => {
      if (isVehicleActor(a)) {
         
         const self = HaulManager.selfBulk(a)
         return { name: a.name, self, inv: 0, total: self }
      }
      const self = HaulManager.sizeBulk(a)
      const inv = HaulManager.inventoryBulk(a)
      return { name: a.name, self, inv, total: self + inv }
   })
   const targetsTotal = rows.reduce((s, r) => s + r.total, 0)
   const cap = HaulManager.haulerCapacity(hauler)

   const rowsHtml = rows
      .map(
         (r) =>
            `<tr><td>${r.name}</td><td style="text-align:center">${formatBulk(r.self)}</td><td style="text-align:center">${formatBulk(r.inv)}</td><td style="text-align:center"><strong>${formatBulk(r.total)}</strong></td></tr>`,
      )
      .join("")

   const formula =
      rows.map((r) => formatBulk(r.total)).join(" + ") +
      ` = ${formatBulk(targetsTotal)}`

   const tooltip = tKey("Haul.CoefficientTooltip")

const SIZE_RANK = { tiny: 0, sm: 1, med: 2, lg: 3, huge: 4, grg: 5 }
   const haulerSize = hauler.system?.traits?.size?.value || "med"
   const haulerRank = SIZE_RANK[haulerSize] ?? 2
   const sizeSteps = haulerRank - 2 

const feltOneItem = (rawBulk) => {
      const lu = Math.round((Number(rawBulk) || 0) * 10) 
      if (sizeSteps > 0) return Math.floor(lu / Math.pow(2, sizeSteps)) / 10
      if (sizeSteps < 0) return (lu * Math.pow(2, -sizeSteps)) / 10
      return lu / 10
   }

const feltForTarget = (a) => {
      if (a?.type === "vehicle") {
         
         return feltOneItem(HaulManager.selfBulk(a))
      }
      const sizeB = HaulManager.sizeBulk(a)
      const invComputed = HaulManager.inventoryBulk(a)
      const lightCount = HaulManager.lightItemCount(a)
      const invWhole = Math.max(0, Math.round(invComputed - lightCount * 0.1))
      let felt = feltOneItem(sizeB) + feltOneItem(invWhole)
      
      felt += lightCount * feltOneItem(0.1)
      return felt
   }
   const feltBulk = (rawCoefMultiplier = 1) =>
      targets.reduce((s, a) => s + feltForTarget(a) * rawCoefMultiplier, 0)

   const treatmentLabel =
      sizeSteps === 0
         ? tKey("Haul.TreatNormal")
         : sizeSteps > 0
           ? tKey("Haul.TreatLighter", {
                factor:
                   sizeSteps === 1 ? "½" : sizeSteps === 2 ? "¼" : "⅛",
             })
           : tKey("Haul.TreatHeavier", { factor: `${Math.pow(2, -sizeSteps)}×` })

   const haulerBiggerThanAll = targets.every((a) => {
      const s = a.system?.traits?.size?.value || "med"
      return haulerRank > (SIZE_RANK[s] ?? 2)
   })
   const elevationDefaultOn = haulerBiggerThanAll

const defaultElevation = SIZE_ELEVATION[haulerSize] ?? 5

   const content = `
      <div class="siege-haul-dialog">
         <p>${tKey("Haul.ConfirmPrompt", { name: hauler.name })}</p>
         <table style="width:100%; margin-bottom:8px;">
            <thead>
               <tr>
                  <th style="text-align:left">${tKey("Haul.ColTarget")}</th>
                  <th>${tKey("Haul.ColSelf")}</th>
                  <th>${tKey("Haul.ColInventory")}</th>
                  <th>${tKey("Haul.ColTotal")}</th>
               </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
         </table>
         <p><strong>${tKey("Haul.TotalFormula")}:</strong> ${formula}</p>
         <div style="margin:4px 0; font-size:0.95em;">
            <strong>${tKey("Haul.SizeTreatment")}:</strong> ${treatmentLabel}
            <a href="https://2e.aonprd.com/Rules.aspx?ID=2164" target="_blank" data-tooltip="${tKey("Haul.SizeTreatmentTip")}"><i class="fa-solid fa-circle-info" style="margin-left:4px;"></i></a>
         </div>
         <hr>
         <div class="form-group">
            <label>
               ${tKey("Haul.Coefficient")}
               <i class="fa-solid fa-circle-info" data-tooltip="${tooltip}" style="cursor:help; margin-left:4px;"></i>
            </label>
            <input type="number" id="haul-coefficient" value="1" min="0" step="0.1" style="width:80px;">
         </div>
         <div class="form-group">
            <label>
               <input type="checkbox" id="haul-apply-elevation" ${elevationDefaultOn ? "checked" : ""}> ${tKey("Haul.ApplyElevation")}
            </label>
            <input type="number" id="haul-elevation" value="${defaultElevation}" step="5" style="width:80px; ${elevationDefaultOn ? "" : "display:none;"}">
         </div>
         <div style="font-size:1.05em; margin-top:8px;">
            <div><strong>${tKey("Haul.YourBulk")}:</strong> ${formatBulk(cap.ownBulk)}</div>
            <div>
               <strong>${tKey("Haul.Thresholds")}:</strong>
               <span style="color:orange;">${tKey("Mount.EncumberedLabel", { value: cap.encumberedAfter })}</span>
               /
               <span style="color:red;">${tKey("Mount.MaxBulkLabel", { value: cap.maxLimit })}</span>
            </div>
            <div><strong>${tKey("Haul.ResultingBulk")}:</strong> <span id="haul-resulting">${formatBulk(cap.ownBulk + feltBulk(1))}</span> <span style="opacity:0.7;">(${tKey("Haul.RawBulk")}: ${formatBulk(targetsTotal)})</span></div>
         </div>
      </div>`

   const result = await foundry.applications.api.DialogV2.wait({
      classes: ["siege-v2-dialog"],
      window: { title: tKey("Haul.DialogTitle") },
      position: { width: 480 },
      content,
      buttons: [
         {
            action: "haul",
            label: tKey("Haul.HaulButton"),
            icon: "fa-solid fa-hand-fist",
            default: true,
            callback: () => {
               const applyElevation =
                  document.getElementById("haul-apply-elevation").checked
               return {
                  coefficient:
                     parseFloat(
                        document.getElementById("haul-coefficient").value,
                     ) || 1,
                  elevation: applyElevation
                     ? parseFloat(
                          document.getElementById("haul-elevation").value,
                       ) || 0
                     : null,
               }
            },
         },
         {
            action: "cancel",
            label: tKey("Haul.CancelButton"),
            icon: "fa-solid fa-xmark",
         },
      ],
      render: (_event, dialog) => {
         const root = dialog.element ?? dialog
         const input = root.querySelector("#haul-coefficient")
         const out = root.querySelector("#haul-resulting")
         const elevToggle = root.querySelector("#haul-apply-elevation")
         const elevInput = root.querySelector("#haul-elevation")
         if (elevToggle && elevInput)
            elevToggle.addEventListener("change", () => {
               elevInput.style.display = elevToggle.checked ? "" : "none"
            })
         if (!input || !out) return
         const update = () => {
            const c = parseFloat(input.value)
            const coef = Number.isFinite(c) && c >= 0 ? c : 1
            out.textContent = formatBulk(cap.ownBulk + feltBulk(coef))
         }
         input.addEventListener("input", update)
         update()
      },
   })

   if (!result || result === "cancel") return
   await HaulManager.haul(hauler, targets, result.coefficient, result.elevation)
}
