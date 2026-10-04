/* ECG model shared by the loader, the hero halo, the 3D strip and the sound. Times in seconds, 72 bpm template. */
var RR = 60 / 72;
function gss(x, m, s){ var d = (x - m) / s; return Math.exp(-0.5 * d * d); }
function ecgV(t){
  t = t - Math.floor(t / RR) * RR;
  var tw = t < 0.46 ? gss(t, 0.46, 0.042) : gss(t, 0.46, 0.03);
  return 0.15 * gss(t, 0.08, 0.018) - 0.08 * gss(t, 0.212, 0.0065) + 1.1 * gss(t, 0.235, 0.0085)
       - 0.22 * gss(t, 0.258, 0.0075) + 0.3 * tw;
}
function hash1(n){ var x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); }
function ecgN(t){ // tiny, stable baseline noise so the trace never looks synthetic
  var i = Math.floor(t * 250), f = t * 250 - i;
  return ((hash1(i) * (1 - f) + hash1(i + 1) * f) - 0.5) * 0.018;
}

/* 3D strip on a canvas: world units are millimetres of ECG paper (25 mm/s, 10 mm/mV). */
function ECG3D(canvas){
  var ctx = canvas.getContext('2d');
  var W = 0, H = 0, DPR = 1;
  var parts = [];
  for(var i = 0; i < 150; i++) parts.push([Math.random(), Math.random(), Math.random(), Math.random()]);
  var glowSprite = (function(){
    var c = document.createElement('canvas'); c.width = c.height = 128;
    var g = c.getContext('2d'); var r = g.createRadialGradient(64,64,0,64,64,64);
    r.addColorStop(0,'rgba(236,255,222,1)'); r.addColorStop(0.18,'rgba(160,250,120,.55)');
    r.addColorStop(0.5,'rgba(90,220,60,.14)'); r.addColorStop(1,'rgba(90,220,60,0)');
    g.fillStyle = r; g.fillRect(0,0,128,128); return c;
  })();

  function sub(a,b){ return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
  function dot(a,b){ return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
  function crs(a,b){ return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
  function nrm(a){ var l = Math.sqrt(dot(a,a)) || 1; return [a[0]/l, a[1]/l, a[2]/l]; }

  var cam = {};
  function setCam(s){
    var tg = [s.tx, s.ty, 0];
    var cp = Math.cos(s.pitch);
    var eye = [tg[0] + s.dist * Math.sin(s.yaw) * cp, tg[1] + s.dist * Math.sin(s.pitch), tg[2] + s.dist * Math.cos(s.yaw) * cp];
    var f = nrm(sub(tg, eye)), r = nrm(crs(f, [0,1,0])), u = crs(r, f);
    cam.e = eye; cam.f = f; cam.r = r; cam.u = u;
    cam.F = s.focal; cam.cx = s.cx * W; cam.cy = s.cy * H;
  }
  var NEAR = 4;
  function camz(p){ return (p[0]-cam.e[0])*cam.f[0] + (p[1]-cam.e[1])*cam.f[1] + (p[2]-cam.e[2])*cam.f[2]; }
  function proj(p){
    var d = [p[0]-cam.e[0], p[1]-cam.e[1], p[2]-cam.e[2]];
    var z = dot(d, cam.f); if(z < NEAR) return null;
    return [cam.cx + dot(d, cam.r) / z * cam.F, cam.cy - dot(d, cam.u) / z * cam.F, z];
  }
  // clip a 3D segment against the near plane, then project
  function seg(a, b){
    var za = camz(a), zb = camz(b);
    if(za < NEAR && zb < NEAR) return null;
    if(za < NEAR){ var t = (NEAR - za) / (zb - za); a = [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t]; }
    else if(zb < NEAR){ var t2 = (NEAR - zb) / (za - zb); b = [b[0]+(a[0]-b[0])*t2, b[1]+(a[1]-b[1])*t2, b[2]+(a[2]-b[2])*t2]; }
    var pa = proj(a), pb = proj(b); if(!pa || !pb) return null;
    return [pa, pb];
  }
  function fog(z, s){ return Math.max(0, Math.min(1, 1 - (z - s.fogNear) / (s.fogFar - s.fogNear))); }

  var api = {
    resize: function(w, h, dpr){
      DPR = dpr; W = w; H = h;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    },
    project: function(p){ return proj(p); },
    /* s: head (ECG seconds, absolute), span (seconds of trace kept behind the head), yaw, pitch, dist, tx, ty,
          focal, cx, cy, fade, time, fogNear, fogFar, marks: [{t, y}] -> projected positions returned */
    draw: function(s){
      ctx.setTransform(DPR,0,0,DPR,0,0);
      ctx.clearRect(0,0,W,H);
      if(s.fade <= 0.001) return [];
      setCam(s);
      var X = function(t){ return t * 25; };
      var headX = X(s.head), x0 = X(Math.max(s.head - s.span, s.t0));
      var FLOOR = -15, A = s.fade;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';

      // floor grid (5 mm), fades with depth
      ctx.lineWidth = 1;
      var fx0 = Math.floor((headX - 95) / 5) * 5, fx1 = headX + 30;
      for(var z = -40; z <= 30; z += 5){
        var sg = seg([fx0, FLOOR, z], [fx1, FLOOR, z]); if(!sg) continue;
        var gr = ctx.createLinearGradient(sg[0][0], sg[0][1], sg[1][0], sg[1][1]);
        gr.addColorStop(0, 'rgba(126,240,90,' + (0.07 * fog(sg[0][2], s) * A) + ')');
        gr.addColorStop(1, 'rgba(126,240,90,' + (0.07 * fog(sg[1][2], s) * A) + ')');
        ctx.strokeStyle = gr; ctx.beginPath(); ctx.moveTo(sg[0][0], sg[0][1]); ctx.lineTo(sg[1][0], sg[1][1]); ctx.stroke();
      }
      for(var fx = fx0; fx <= fx1; fx += 5){
        var sg2 = seg([fx, FLOOR, -40], [fx, FLOOR, 30]); if(!sg2) continue;
        var mz = (sg2[0][2] + sg2[1][2]) / 2;
        ctx.strokeStyle = 'rgba(126,240,90,' + (0.05 * fog(mz, s) * A) + ')';
        ctx.beginPath(); ctx.moveTo(sg2[0][0], sg2[0][1]); ctx.lineTo(sg2[1][0], sg2[1][1]); ctx.stroke();
      }

      // paper grid on the strip plane (1 mm and 5 mm), only where paper exists
      var gx0 = Math.floor(Math.max(x0 - 8, headX - 95)), gx1 = headX + 12;
      for(var gx = gx0; gx <= gx1; gx += 1){
        var big = (Math.round(gx) % 5 === 0);
        var sg3 = seg([gx, -8, 0], [gx, 16, 0]); if(!sg3) continue;
        var fz = fog((sg3[0][2] + sg3[1][2]) / 2, s);
        var ahead = gx > headX ? Math.max(0, 1 - (gx - headX) / 12) : 1;
        ctx.strokeStyle = 'rgba(126,240,90,' + ((big ? 0.16 : 0.055) * fz * A * ahead) + ')';
        ctx.lineWidth = big ? 1 : 0.7;
        ctx.beginPath(); ctx.moveTo(sg3[0][0], sg3[0][1]); ctx.lineTo(sg3[1][0], sg3[1][1]); ctx.stroke();
      }
      for(var gy = -8; gy <= 16; gy += 1){
        var big2 = (gy % 5 === 0);
        var sg4 = seg([gx0, gy, 0], [gx1, gy, 0]); if(!sg4) continue;
        var g2 = ctx.createLinearGradient(sg4[0][0], sg4[0][1], sg4[1][0], sg4[1][1]);
        var aa = (big2 ? 0.16 : 0.055) * A;
        g2.addColorStop(0, 'rgba(126,240,90,' + (aa * fog(sg4[0][2], s)) + ')');
        g2.addColorStop(0.92, 'rgba(126,240,90,' + (aa * fog(sg4[1][2], s)) + ')');
        g2.addColorStop(1, 'rgba(126,240,90,0)');
        ctx.strokeStyle = g2; ctx.lineWidth = big2 ? 1 : 0.7;
        ctx.beginPath(); ctx.moveTo(sg4[0][0], sg4[0][1]); ctx.lineTo(sg4[1][0], sg4[1][1]); ctx.stroke();
      }

      // sample the trace
      var pts = [], step = 0.004;
      var tStart = Math.max(s.head - s.span, s.t0);
      for(var t = tStart; t <= s.head + 1e-6; t += step){
        var v = (t < 0 ? 0 : ecgV(t)) + ecgN(t);
        pts.push([X(t), v * 10, 0, t]);
      }
      if(pts.length < 2) pts.push([headX, ecgV(s.head) * 10, 0, s.head]);

      // floor reflection
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(126,240,90,' + (0.1 * A) + ')'; ctx.lineWidth = 1.2;
      ctx.beginPath(); var started = false;
      for(var k = 0; k < pts.length; k += 2){
        var pr = proj([pts[k][0], 2 * FLOOR - pts[k][1], 0]); if(!pr){ started = false; continue; }
        if(!started){ ctx.moveTo(pr[0], pr[1]); started = true; } else ctx.lineTo(pr[0], pr[1]);
      }
      ctx.stroke();

      // particles (cells drifting in the dark)
      var span = 110;
      for(var q = 0; q < parts.length; q++){
        var P = parts[q];
        var px = headX - 90 + ((P[0] * span + s.time * 1.2 * (0.3 + P[3])) % span);
        var py = -12 + ((P[1] * 34 + s.time * (0.5 + P[3] * 0.8)) % 34);
        var pz = -35 + P[2] * 62;
        var pp = proj([px, py, pz]); if(!pp) continue;
        var fz2 = fog(pp[2], s); if(fz2 <= 0) continue;
        var rad = Math.max(0.4, 26 / pp[2]) * (0.6 + P[3]);
        var tw = 0.5 + 0.5 * Math.sin(s.time * (1 + P[3] * 2) + P[0] * 40);
        ctx.fillStyle = 'rgba(170,250,140,' + (0.28 * fz2 * A * (0.4 + 0.6 * tw)) + ')';
        ctx.beginPath(); ctx.arc(pp[0], pp[1], rad, 0, 6.283); ctx.fill();
      }

      // the trace in depth-sorted chunks, three passes each (glow, body, core)
      var P2 = [];
      for(var m = 0; m < pts.length; m++){ var pj = proj(pts[m]); P2.push(pj); }
      var CH = 6;
      for(var pass = 0; pass < 3; pass++){
        var baseW = pass === 0 ? 7 : (pass === 1 ? 2.6 : 1.1);
        var col = pass === 2 ? '236,255,222' : '126,240,90';
        var al = pass === 0 ? 0.13 : (pass === 1 ? 0.5 : 0.95);
        for(var c0 = 0; c0 < P2.length - 1; c0 += CH){
          var c1 = Math.min(c0 + CH, P2.length - 1);
          var mid = P2[Math.floor((c0 + c1) / 2)] || P2[c0]; if(!mid) continue;
          var age = (s.head - pts[c0][3]) / s.span;
          var fade = fog(mid[2], s) * Math.max(0, 1 - age * age) * A;
          if(fade <= 0.01) continue;
          ctx.strokeStyle = 'rgba(' + col + ',' + (al * fade) + ')';
          ctx.lineWidth = Math.max(0.6, baseW * 60 / mid[2] * s.lineScale);
          ctx.beginPath(); var st = false;
          for(var n = c0; n <= c1; n++){ var pn = P2[n]; if(!pn){ st = false; continue; } if(!st){ ctx.moveTo(pn[0], pn[1]); st = true; } else ctx.lineTo(pn[0], pn[1]); }
          ctx.stroke();
        }
      }

      // R-peak ripple on the floor, tied to trace time so it rewinds with scroll
      var rT = Math.floor((s.head - 0.235) / RR) * RR + 0.235;
      var ageR = s.head - rT;
      if(rT >= s.t0 && ageR >= 0 && ageR < 0.4){
        var rr = 2 + ageR * 42, ra = (1 - ageR / 0.4);
        ctx.strokeStyle = 'rgba(126,240,90,' + (0.35 * ra * ra * A) + ')'; ctx.lineWidth = 1.2;
        ctx.beginPath(); var s2 = false;
        for(var an = 0; an <= 48; an++){
          var th = an / 48 * 6.283;
          var pq = proj([X(rT) + Math.cos(th) * rr, FLOOR, Math.sin(th) * rr]);
          if(!pq){ s2 = false; continue; }
          if(!s2){ ctx.moveTo(pq[0], pq[1]); s2 = true; } else ctx.lineTo(pq[0], pq[1]);
        }
        ctx.stroke();
      }

      // write head: erase bar + glow
      var hv = (s.head < 0 ? 0 : ecgV(s.head)) * 10;
      var hb = seg([headX + 0.4, -8, 0], [headX + 0.4, 16, 0]);
      if(hb){
        var hg = ctx.createLinearGradient(hb[0][0], hb[0][1], hb[1][0], hb[1][1]);
        hg.addColorStop(0, 'rgba(126,240,90,0)'); hg.addColorStop(0.5, 'rgba(126,240,90,' + (0.22 * A) + ')'); hg.addColorStop(1, 'rgba(126,240,90,0)');
        ctx.strokeStyle = hg; ctx.lineWidth = Math.max(1, 3 * 60 / ((hb[0][2] + hb[1][2]) / 2));
        ctx.beginPath(); ctx.moveTo(hb[0][0], hb[0][1]); ctx.lineTo(hb[1][0], hb[1][1]); ctx.stroke();
      }
      var hp = proj([headX, hv, 0]);
      if(hp){
        var gs = Math.max(24, 2200 / hp[2]) * (1 + 0.5 * s.pulse);
        ctx.globalAlpha = A; ctx.drawImage(glowSprite, hp[0] - gs / 2, hp[1] - gs / 2, gs, gs); ctx.globalAlpha = 1;
      }
      ctx.globalCompositeOperation = 'source-over';

      // anchors for DOM labels
      var out = [];
      if(s.marks){
        for(var mk = 0; mk < s.marks.length; mk++){
          var M = s.marks[mk];
          var base = proj([X(M.t), M.y, 0]);
          var top = proj([X(M.t), M.y + M.h, 0]);
          out.push({ on: s.head >= M.t, a: base, b: top });
          if(base && top && s.head >= M.t){
            var fm = fog(base[2], s) * A;
            ctx.strokeStyle = 'rgba(238,242,232,' + (0.35 * fm) + ')'; ctx.lineWidth = 1;
            ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(base[0], base[1]); ctx.lineTo(top[0], top[1]); ctx.stroke(); ctx.setLineDash([]);
            ctx.fillStyle = 'rgba(236,255,222,' + (0.9 * fm) + ')'; ctx.beginPath(); ctx.arc(base[0], base[1], 2.2, 0, 6.283); ctx.fill();
          }
        }
      }
      return out;
    }
  };
  return api;
}

export { RR, gss, ecgV, hash1, ecgN, ECG3D };
