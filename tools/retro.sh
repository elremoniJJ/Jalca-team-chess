#!/bin/bash
# usage: bash tools/retro.sh "input.mp4" out-name [seconds] [width] [start-second]
IN="$1"; OUT="$2"; SECS="${3:-2}"; W="${4:-80}"; START="${5:-0}"
mkdir -p tools/video-out
FX="fps=8,scale=${W}:-2:flags=area,eq=contrast=1.3:saturation=0.45:brightness='0.03*sin(n*2.7)+0.02*random(1)':eval=frame,colorchannelmixer=.95:.12:0:0:.05:.9:.05:0:0:.1:.7,noise=alls=24:allf=t,geq=lum='if(lt(random(1),0.004),235,if(eq(X,floor(W*random(2)))*lt(random(3),0.35),215,lum(X,Y)))':cb='cb(X,Y)':cr='cr(X,Y)'"
PAL="split[a][b];[a]palettegen=max_colors=14:stats_mode=single[p];[b][p]paletteuse=dither=bayer:bayer_scale=2"
ffmpeg -y -loglevel error -ss "$START" -i "$IN" -t "$SECS" -an -vf "$FX,$PAL" -c:v libx264 -preset veryslow -crf 30 -pix_fmt yuv420p -movflags +faststart "tools/video-out/$OUT.mp4"
ffmpeg -y -loglevel error -i "tools/video-out/$OUT.mp4" -vf "scale=iw*5:ih*5:flags=neighbor" -c:v libx264 -crf 20 -pix_fmt yuv420p "tools/video-out/$OUT-preview.mp4"
ls -la tools/video-out/$OUT*.mp4
