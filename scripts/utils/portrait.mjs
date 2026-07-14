export const validImg = (src, fallback) =>
   typeof src === "string" && src.trim() !== "" && !/\.(webm|mp4)$/i.test(src)
      ? src
      : fallback

export const clampPortraitOffset = (offset, zoom) => {
   const z = Math.max(1, Number(zoom) || 1)
   const limitPctOfBox = (1 - 1 / z) * 50
   const o = Number(offset) || 0
   return Math.max(-limitPctOfBox, Math.min(limitPctOfBox, o))
}

export const portraitImgStyle = (p) => {
   const zoom = Math.max(
      0.05,
      Number(p?.foregroundZoom ?? p?.foregroundScale ?? p?.zoom ?? p?.scale ?? 1) || 1,
   )
   const ox =
      Number(p?.foregroundOx ?? p?.foregroundOffsetX ?? p?.ox ?? p?.offsetX ?? 0) || 0
   const oy =
      Number(p?.foregroundOy ?? p?.foregroundOffsetY ?? p?.oy ?? p?.offsetY ?? 0) || 0
   const posX = 50 + ox
   const posY = 50 + oy
   return `position:absolute; inset:0; width:100%; height:100%; object-fit:cover; object-position:${posX}% ${posY}%; transform:scale(${zoom}); transform-origin:${posX}% ${posY}%;`
}

export const portraitBackgroundImgStyle = (p = {}) => {
   const zoom = Math.max(
      1,
      Number(p.backgroundZoom ?? p.backgroundScale ?? p.scale ?? 1) || 1,
   )
   const ox = clampPortraitOffset(
      p.backgroundOx ?? p.backgroundOffsetX ?? p.offsetX ?? 0,
      zoom,
   )
   const oy = clampPortraitOffset(
      p.backgroundOy ?? p.backgroundOffsetY ?? p.offsetY ?? 0,
      zoom,
   )
   const posX = 50 + ox
   const posY = 50 + oy
   return `position:absolute; inset:0; width:100%; height:100%; object-fit:cover; object-position:${posX}% ${posY}%; transform:scale(${zoom}); transform-origin:${posX}% ${posY}%;`
}

export const normalizePortraitData = (raw, fallbackSrc) => {
   const fallback = fallbackSrc || ""
   if (typeof raw === "string")
      return {
         src: validImg(raw || fallback, fallback),
         backgroundSrc: "",
         scale: 1,
         offsetX: 0,
         offsetY: 0,
         backgroundScale: 1,
         backgroundOffsetX: 0,
         backgroundOffsetY: 0,
         foregroundScale: 1,
         foregroundOffsetX: 0,
         foregroundOffsetY: 0,
         fit: "cover",
      }
   const data = raw && typeof raw === "object" ? raw : {}
   const layered =
      Number(data.portraitLayersVersion) >= 2 ||
      !!data.backgroundSrc ||
      !!data.foreground
   const foreground =
      data.foreground && typeof data.foreground === "object" ? data.foreground : {}
   const background =
      data.background && typeof data.background === "object" ? data.background : {}
   const backgroundScale = Math.max(
      1,
      Number(background.scale ?? data.backgroundScale ?? data.scale ?? 1) || 1,
   )
   const foregroundScale = Math.max(
      0.05,
      Number(
         foreground.scale ??
            data.foregroundScale ??
            (layered ? 1 : data.scale) ??
            1,
      ) || 1,
   )
   return {
      portraitLayersVersion: 2,
      src: validImg(foreground.src || data.src || fallback, fallback),
      backgroundSrc: validImg(background.src || data.backgroundSrc || "", ""),
      scale: backgroundScale,
      offsetX: clampPortraitOffset(
         background.offsetX ?? data.backgroundOffsetX ?? data.offsetX ?? 0,
         backgroundScale,
      ),
      offsetY: clampPortraitOffset(
         background.offsetY ?? data.backgroundOffsetY ?? data.offsetY ?? 0,
         backgroundScale,
      ),
      backgroundScale,
      backgroundOffsetX: clampPortraitOffset(
         background.offsetX ?? data.backgroundOffsetX ?? data.offsetX ?? 0,
         backgroundScale,
      ),
      backgroundOffsetY: clampPortraitOffset(
         background.offsetY ?? data.backgroundOffsetY ?? data.offsetY ?? 0,
         backgroundScale,
      ),
      foregroundScale,
      foregroundOffsetX:
         foreground.offsetX ??
         data.foregroundOffsetX ??
         (layered ? 0 : data.offsetX) ??
         0,
      foregroundOffsetY:
         foreground.offsetY ??
         data.foregroundOffsetY ??
         (layered ? 0 : data.offsetY) ??
         0,
      fit: foreground.fit || data.fit || "cover",
   }
}
