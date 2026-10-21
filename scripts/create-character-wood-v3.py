"""Deterministic material data: warm timber with subtle contact wear, no lighting."""
from pathlib import Path
import json
import numpy as np
from PIL import Image,ImageDraw,ImageFilter
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'docs/assets/characters/v3/textures';OUT.mkdir(parents=True,exist_ok=True)
N=1024;rng=np.random.default_rng(67341);y,x=np.mgrid[0:N,0:N].astype(float);u=x/N;v=y/N
def smooth_noise(size,seed):
    rr=np.random.default_rng(seed);a=(rr.random((size,size))*255).astype('uint8')
    return np.asarray(Image.fromarray(a).resize((N,N),Image.Resampling.BICUBIC),float)/255-.5
coarse=smooth_noise(11,11);fine=smooth_noise(150,12)
warp=u+.008*np.sin(v*2*np.pi)+.004*np.sin(v*6*np.pi+u*2*np.pi)
fiber=np.sin(warp*2*np.pi*126+coarse*2)
pore=np.maximum(0,np.sin(warp*2*np.pi*253+v*8))**18
grain=.016*fiber+.050*coarse+.012*fine-.018*pore+.015*np.sin(warp*2*np.pi*17+coarse*2)
end=np.exp(-((v-.035)/.026)**2)+np.exp(-((v-.965)/.026)**2)
recess=np.exp(-((v-.102)/.018)**2)+np.exp(-((v-.898)/.018)**2)
crackim=Image.new('L',(N,N));draw=ImageDraw.Draw(crackim)
for i in range(16):
    xx=float(rng.uniform(.03,.97));start=float(rng.uniform(.12,.82));length=float(rng.uniform(.04,.15))
    pts=[((xx+.0015*np.sin(k*.8+i))*N,(start+length*k/14)*N) for k in range(15)]
    draw.line(pts,fill=int(rng.uniform(80,170)),width=1)
cracks=np.asarray(crackim.filter(ImageFilter.GaussianBlur(.25)),float)/255
scratchim=Image.new('L',(N,N));draw=ImageDraw.Draw(scratchim)
for i in range(38):
    xx=float(rng.uniform(.01,.99));yy=float(rng.choice([rng.uniform(.015,.12),rng.uniform(.88,.985)]));length=float(rng.uniform(.01,.055))
    draw.line([(xx*N,yy*N),((xx+.008*rng.normal())*N,(yy+length)*N)],fill=int(rng.uniform(40,125)),width=int(rng.choice([1,1,2])))
scratches=np.asarray(scratchim.filter(ImageFilter.GaussianBlur(.45)),float)/255
patina=np.clip(.27*recess*(.65+coarse)+.03*np.maximum(0,-coarse),0,.18)
rgb=np.zeros((N,N,3),float)
for c,base in enumerate([.400,.240,.115]):
    rgb[:,:,c]=base+grain*(1 if c==0 else .8 if c==1 else .6)+end*.023+scratches*.045-cracks*.10-patina*(.20 if c==0 else .16 if c==1 else .12)
rgb=np.clip(rgb,.03,.94)
Image.fromarray(np.uint8(np.round(rgb*255))).save(OUT/'wood-basecolor.png',optimize=True)
height=.16*fiber+.12*fine-.8*cracks+.32*scratches-.10*pore
# Pixel derivatives keep microrelief shallow; major grain stays in albedo.
height=np.asarray(Image.fromarray(height.astype('float32'),mode='F').resize((512,512),Image.Resampling.BILINEAR),float)
dy,dx=np.gradient(height);nn=np.stack([-dx*.24,-dy*.24,np.ones_like(dx)],-1);nn/=np.linalg.norm(nn,axis=-1)[:,:,None]
Image.fromarray(np.uint8(np.round((nn*.5+.5)*255))).save(OUT/'wood-normal.png',optimize=True)
rough=np.clip(.49+.05*coarse+.035*fine+.09*end+.12*patina+.13*cracks-.04*scratches,.40,.74)
ao=np.clip(1-.07*cracks-.035*patina,.91,1)
orm=np.stack([ao,rough,np.zeros_like(rough)],-1)
im=Image.fromarray(np.uint8(np.round(orm*255))).resize((512,512),Image.Resampling.BOX);im.save(OUT/'wood-orm.png',optimize=True)
stats={'seed':67341,'color_space':'basecolor sRGB; normal/ORM linear','color_resolution':[1024,1024],'data_resolution':[512,512],'roughness_range':[float(rough.min()),float(rough.max())],'ao_min':float(ao.min()),'microfissure_coverage_fraction':float(np.mean(cracks>.1)),'scratch_coverage_fraction':float(np.mean(scratches>.1)),'placement':'Shared UV-space contact bands near v ends; not a unique dirt atlas per body part','no_baked_lighting':True}
(OUT/'wood-map-stats.json').write_text(json.dumps(stats,indent=2),encoding='utf-8')
print(json.dumps(stats))
