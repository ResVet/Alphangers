/* Hologram heart: raymarched SDF with conduction wave. Plain WebGL1. */
function HeartGL(canvas, opt){
  opt = opt || {};
  var gl = null;
  try{ gl = canvas.getContext('webgl', {alpha:true, premultipliedAlpha:true, antialias:false, depth:false, stencil:false, powerPreference:'high-performance'}); }catch(e){}
  if(!gl) return null;
  var STEPS = opt.steps || 80;

  var VS = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
  function fragSrc(deriv, PREC){ return (deriv ? '#extension GL_OES_standard_derivatives : enable\n#define DERIV 1\n' : '') +
  'precision ' + PREC + ' float;\n' +
  'uniform vec2 uRes;uniform float uTime,uCyc,uAS,uVS,uFade,uYaw,uPitch,uZoom,uLift,uGlow;\n' +
  'float smin(float a,float b,float k){float h=max(k-abs(a-b),0.)/k;return min(a,b)-h*h*k*.25;}\n' +
  'float sdEl(vec3 p,vec3 r){float k0=length(p/r);float k1=length(p/(r*r));return k0*(k0-1.)/max(k1,1e-4);}\n' +
  'float sdCa(vec3 p,vec3 a,vec3 b,float r){vec3 pa=p-a,ba=b-a;float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.);return length(pa-ba*h)-r;}\n' +
  'float sdRC(vec3 p,vec3 a,vec3 b,float r1,float r2){vec3 ba=b-a;float l2=dot(ba,ba);float rr=r1-r2;float a2=l2-rr*rr;float il2=1./l2;vec3 pa=p-a;float y=dot(pa,ba);float z=y-l2;vec3 xv=pa*l2-ba*y;float x2=dot(xv,xv);float y2=y*y*l2;float z2=z*z*l2;float k=sign(rr)*rr*rr*x2;if(sign(z)*a2*z2>k)return sqrt(x2+z2)*il2-r2;if(sign(y)*a2*y2<k)return sqrt(x2+y2)*il2-r1;return (sqrt(x2*a2*il2)+y*rr)*il2-r1;}\n' +
  'mat2 r2(float a){float c=cos(a),s=sin(a);return mat2(c,s,-s,c);}\n' +
  /* anatomy, anterior view: x = viewer right (patient left), y = up, z = toward viewer */
  'float vent(vec3 p){vec3 c=vec3(.14,-.2,.08);float s=1.-.06*uVS;vec3 q=(p-c)/s+c;' +
    'vec3 f=vec3(q.xy,q.z/.82);' +
    'float d=sdRC(f,vec3(-.12,.22,0.),vec3(.52,-.74,.16),.56,.15)*.82;' +
    'd=smin(d,sdEl(q-vec3(.3,-.2,-.08),vec3(.42,.52,.4)),.2);' +
    'd=smin(d,sdEl(q-vec3(-.2,-.12,.16),vec3(.46,.42,.3)),.2);' +
    'float sp=dot(q-vec3(-.05,.25,0.),vec3(.895,.445,-.036));d+=.018*exp(-sp*sp/.0018);' +
    'return d*s;}\n' +
  'float atri(vec3 p){vec3 c=vec3(-.2,.48,-.15);float s=1.-.05*uAS;vec3 q=(p-c)/s+c;' +
    'float d=sdEl(q-vec3(-.66,.36,0.),vec3(.3,.38,.3));' +
    'd=smin(d,sdEl(q-vec3(.12,.54,-.4),vec3(.4,.24,.26)),.16);' +
    'vec3 r=q-vec3(-.36,.6,.24);r.xy=r2(-.6)*r.xy;d=smin(d,sdEl(r,vec3(.19,.09,.1)),.12);' +
    'vec3 l=q-vec3(.46,.5,.06);l.xy=r2(.35)*l.xy;d=smin(d,sdEl(l,vec3(.16,.08,.11)),.1);' +
    'return d*s;}\n' +
  /* the vessels in groups, each with a bounding sphere: ascending aorta and arch, arch branches,
     pulmonary branches, venae cavae; the descending aorta and pulmonary trunk are single capsules */
  'float gAs(vec3 p){float d=sdCa(p,vec3(-.12,.42,.05),vec3(-.14,.98,.02),.16);' +
    'd=smin(d,sdCa(p,vec3(-.14,.98,.02),vec3(.06,1.16,-.1),.15),.05);' +
    'd=smin(d,sdCa(p,vec3(.06,1.16,-.1),vec3(.3,1.06,-.28),.14),.05);' +
    'return smin(d,sdCa(p,vec3(.3,1.06,-.28),vec3(.36,.78,-.38),.13),.05);}\n' +
  'float gDa(vec3 p){return sdCa(p,vec3(.36,.78,-.38),vec3(.3,-.3,-.5),.12);}\n' +
  'float gBr(vec3 p){float d=sdCa(p,vec3(-.08,1.08,-.02),vec3(-.22,1.48,0.),.062);' +
    'd=smin(d,sdCa(p,vec3(.08,1.14,-.12),vec3(.1,1.54,-.12),.046),.04);' +
    'return smin(d,sdCa(p,vec3(.24,1.1,-.22),vec3(.37,1.48,-.24),.052),.04);}\n' +
  'float gPt(vec3 p){return sdCa(p,vec3(-.02,.26,.34),vec3(.2,.84,.2),.14);}\n' +
  'float gPb(vec3 p){return smin(sdCa(p,vec3(.2,.82,.2),vec3(.64,.88,-.04),.09),sdCa(p,vec3(.18,.8,.13),vec3(-.56,.86,-.22),.09),.04);}\n' +
  'float gCv(vec3 p){return smin(sdCa(p,vec3(-.6,.52,-.02),vec3(-.53,1.28,-.08),.12),sdCa(p,vec3(-.62,.16,-.12),vec3(-.59,-.14,-.16),.12),.05);}\n' +
  /* exact union, used for colouring the surface */
  'float vess(vec3 p){float d=smin(gAs(p),gDa(p),.05);d=smin(d,gBr(p),.04);d=smin(d,gPt(p),.1);d=smin(d,gPb(p),.05);return smin(d,gCv(p),.05);}\n' +
  /* While marching, a group is added only when its bounding sphere is close enough to change
     the blend: nearer than the vessels so far plus the blend radius, and, once the chambers are
     clearly the nearest surface, near enough to reach past them. Farther groups cannot change
     the result, so skipping them returns the same distance. */
  '#define ADD(G,C,R,K) {float b_=length(p-C)-R;if(b_<v+K&&(v<d+.06||b_<d+.06+K*.25))v=smin(v,G(p),K);}\n' +
  'float map(vec3 p){float d=smin(vent(p),atri(p),.07);float v=gDa(p);' +
    'ADD(gAs,vec3(.08,.82,-.12),.7,.05)' +
    'ADD(gBr,vec3(.08,1.31,-.13),.5,.04)' +
    'ADD(gPt,vec3(.09,.55,.27),.47,.1)' +
    'ADD(gPb,vec3(.04,.85,-.04),.77,.05)' +
    'ADD(gCv,vec3(-.58,.57,-.08),.9,.05)' +
    'return smin(d,v,.06);}\n' +
  'vec3 nrm(vec3 p){const vec2 k=vec2(1.,-1.);const float h=.002;return normalize(k.xyy*map(p+k.xyy*h)+k.yyx*map(p+k.yyx*h)+k.yxy*map(p+k.yxy*h)+k.xxx*map(p+k.xxx*h));}\n' +
  'vec3 rs(vec3 ro,vec3 rd,vec3 a,vec3 b){vec3 ba=b-a,oa=ro-a;float d0=dot(rd,ba),d1=dot(rd,oa),d2=dot(ba,ba),d3=dot(ba,oa);' +
    'float s=clamp((d3-d0*d1)/max(d2-d0*d0,1e-5),0.,1.);float t=max(d0*s-d1,0.);return vec3(length(oa+rd*t-ba*s),s,t);}\n' +
  'float wire(vec3 ro,vec3 rd,vec3 a,vec3 b,float s0,float s1,float tHit){' +
    'vec3 q=rs(ro,rd,a,b);float w=.011;float g=exp(-q.x*q.x/(w*w));' +
    'float tw=.198+.045*mix(s0,s1,q.y);float wave=exp(-pow((uCyc-tw)/.01,2.));' +
    'float on=smoothstep(tw-.004,tw+.01,uCyc)*(1.-smoothstep(.34,.48,uCyc));' +
    'float occ=(tHit>0.&&tHit<q.z)?.6:1.;return g*(.16+on*.3+wave*1.8)*occ;}\n' +
  'void main(){' +
    'vec2 uv=(gl_FragCoord.xy-.5*uRes)/uRes.y;' +
    'vec3 tgt=vec3(0.,.34+uLift,0.);float D=6.2/uZoom;' +
    'vec3 ro=vec3(0.,.34+uLift,D);vec3 rd=normalize(vec3(uv*.52,-1.));' +
    'vec3 o=ro-tgt;o.yz=r2(uPitch)*o.yz;o.xz=r2(uYaw)*o.xz;ro=o+tgt;rd.yz=r2(uPitch)*rd.yz;rd.xz=r2(uYaw)*rd.xz;' +
    'vec3 bc=vec3(0.,.36,-.06);float br=1.52;vec3 oc=ro-bc;float b=dot(oc,rd);float c=dot(oc,oc)-br*br;float h=b*b-c;' +
    'vec4 col=vec4(0.);float tHit=-1.;float minD=1e3;' +
    'if(h>0.){h=sqrt(h);float t=max(-b-h,0.);float tmax=-b+h;' +
      'for(int i=0;i<' + STEPS + ';i++){vec3 p=ro+rd*t;float d=map(p);minD=min(minD,d);if(d<.0012*t){tHit=t;break;}t+=d*.92;if(t>tmax)break;}' +
      'if(tHit>0.){vec3 p=ro+rd*tHit;vec3 n=nrm(p);' +
        'float dv=vent(p),da=atri(p),dx=vess(p);float mn=min(dv,min(da,dx));' +
        'vec3 w=exp(-60.*(vec3(dv,da,dx)-mn));w/=(w.x+w.y+w.z);' +
        'float fr=pow(1.-clamp(dot(n,-rd),0.,1.),2.3);' +
        'vec3 L=normalize(vec3(-.45,.75,.55));float dif=clamp(dot(n,L),0.,1.);float spc=pow(clamp(dot(reflect(rd,n),L),0.,1.),30.);' +
        'float sy=p.y*14.;float fy=abs(fract(sy)-.5);\n' +
        '#ifdef DERIV\n float lw=clamp(fwidth(sy),.02,.3);\n#else\n float lw=.06;\n#endif\n' +
        'float line=smoothstep(.5-lw*1.6,.5-lw*.3,fy);' +
        'float tA=.04+.085*clamp(length(p-vec3(-.54,.7,.14))/1.15,0.,1.);' +
        'float nv=clamp(length(p-vec3(.1,-.3,.22))/1.2,0.,1.);float tV=.205+.07*nv;' +
        'float tX=.29+.18*clamp(min(length(p-vec3(-.12,.42,.05)),length(p-vec3(0.,.32,.36)))/1.3,0.,1.);' +
        'float tAct=w.x*tV+w.y*tA+w.z*tX;float band=mix(.011,.028,w.z);' +
        'float wave=exp(-pow((uCyc-tAct)/band,2.));' +
        'float tRep=.43+.09*(1.-nv);' +
        'float dep=w.x*smoothstep(tV,tV+.02,uCyc)*(1.-smoothstep(tRep,tRep+.07,uCyc))+w.y*smoothstep(tA,tA+.02,uCyc)*(1.-smoothstep(.2,.3,uCyc));' +
        'float scan=exp(-pow((p.y-(fract(uTime*.16)*2.8-.95))*6.,2.));' +
        'vec3 rim=mix(vec3(.42,1.,.38),vec3(.86,.96,1.),w.z*.55);' +
        'vec3 base=vec3(.018,.085,.035)*(.4+.9*dif);' +
        'vec3 cc=base+rim*fr*1.2+vec3(.45,1.,.42)*line*(.05+.38*fr)+vec3(.9,1.,.85)*spc*.3' +
          '+vec3(.85,1.,.7)*wave*.72+vec3(.14,.62,.2)*dep*.5+vec3(.55,1.,.5)*scan*.2;' +
        'float al=clamp(.2+fr*.85+line*.1+wave*.45+dep*.22+scan*.1,0.,1.);' +
        'col=vec4(cc*al,al);}' +
      'float g=0.;' +
      'g+=wire(ro,rd,vec3(-.16,.26,.12),vec3(-.04,.1,.19),0.,.2,tHit);' +
      'g+=wire(ro,rd,vec3(-.04,.1,.19),vec3(.24,-.3,.15),.2,.6,tHit);' +
      'g+=wire(ro,rd,vec3(.24,-.3,.15),vec3(.5,-.66,.16),.6,1.,tHit);' +
      'g+=wire(ro,rd,vec3(-.04,.1,.19),vec3(-.1,-.28,.3),.2,.6,tHit);' +
      'g+=wire(ro,rd,vec3(-.1,-.28,.3),vec3(.28,-.56,.31),.6,1.,tHit);' +
      'g+=wire(ro,rd,vec3(.5,-.66,.16),vec3(.66,-.24,0.),.95,1.,tHit);' +
      'g+=wire(ro,rd,vec3(.28,-.56,.31),vec3(-.3,-.34,.3),.95,1.,tHit);' +
      'vec3 SA=vec3(-.54,.7,.14),AV=vec3(-.16,.26,.12);' +
      'float tS=max(dot(SA-ro,rd),0.);float dS=length(ro+rd*tS-SA);' +
      'float tN=max(dot(AV-ro,rd),0.);float dN=length(ro+rd*tN-AV);' +
      'float fS=exp(-pow((uCyc-.045)/.02,2.))*1.5+.22;float fN=(smoothstep(.1,.13,uCyc)*(1.-smoothstep(.19,.22,uCyc)))*1.3+.18;' +
      'float fl=fS*exp(-dS*dS/.0011)+fN*exp(-dN*dN/.0008)+.1*fS*exp(-dS*18.)+.08*fN*exp(-dN*20.);' +
      'vec3 wc=vec3(.85,1.,.75)*(g+fl);' +
      'col.rgb+=wc;col.a=max(col.a,clamp(max(max(wc.r,wc.g),wc.b),0.,1.));' +
      'if(tHit<0.){float gl=exp(-minD*16.)*.26*uGlow*smoothstep(0.,.6,h);col.rgb+=vec3(.22,.78,.3)*gl;col.a=max(col.a,gl*.8);}' +
    '}' +
    'gl_FragColor=col*uFade;}'; }

  function sh(type, src){ var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)){ if(window.console) console.warn(gl.getShaderInfoLog(s)); return null; } return s; }
  var U = {}, lost = false;
  function init(){
    var deriv = !!gl.getExtension('OES_standard_derivatives');
    var hp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    var PREC = (hp && hp.precision > 0) ? 'highp' : 'mediump';
    var vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, fragSrc(deriv, PREC));
    if(!vs || !fs) return false;
    var pr = gl.createProgram(); gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
    if(!gl.getProgramParameter(pr, gl.LINK_STATUS)) return false;
    gl.useProgram(pr);
    var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    ['uRes','uTime','uCyc','uAS','uVS','uFade','uYaw','uPitch','uZoom','uLift','uGlow'].forEach(function(n){ U[n] = gl.getUniformLocation(pr, n); });
    gl.clearColor(0,0,0,0);
    return true;
  }
  if(!init()) return null;
  canvas.addEventListener('webglcontextlost', function(e){ e.preventDefault(); lost = true; }, false);
  canvas.addEventListener('webglcontextrestored', function(){ lost = !init(); if(!lost) gl.viewport(0, 0, canvas.width, canvas.height); }, false);

  var api = {
    gl: gl,
    resize: function(w, h, scale){
      if(lost) return;
      var W = Math.max(2, Math.round(w * scale)), H = Math.max(2, Math.round(h * scale));
      if(canvas.width !== W || canvas.height !== H){ canvas.width = W; canvas.height = H; }
      gl.viewport(0, 0, W, H);
    },
    draw: function(s){
      if(lost || gl.isContextLost()) return;
      gl.uniform2f(U.uRes, canvas.width, canvas.height);
      gl.uniform1f(U.uTime, s.time); gl.uniform1f(U.uCyc, s.cyc);
      gl.uniform1f(U.uAS, s.as); gl.uniform1f(U.uVS, s.vs);
      gl.uniform1f(U.uFade, s.fade); gl.uniform1f(U.uYaw, s.yaw); gl.uniform1f(U.uPitch, s.pitch);
      gl.uniform1f(U.uZoom, s.zoom || 1); gl.uniform1f(U.uLift, s.lift || 0); gl.uniform1f(U.uGlow, s.glow == null ? 1 : s.glow);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  };
  return api;
}

export { HeartGL };
