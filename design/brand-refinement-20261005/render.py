import bpy, math, os
from mathutils.geometry import tessellate_polygon
from mathutils import Vector
OUT=os.path.dirname(os.path.abspath(__file__))
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
# Original split flare: two independent ribbons rise around a protected negative-space seam.
A=[(48,6),(48,26),(34,36),(20,49),(8,62),(9,78),(20,91),(17,72),(32,62),(47,51),(63,39),(63,24)]
B=[(67,39),(79,48),(92,63),(97,80),(92,98),(79,113),(60,120),(65,105),(63,94),(51,82),(42,77),(53,68),(65,61),(69,52)]
# Cubic subdivision gives a flowing silhouette; deliberately keep upper tips crisp.
def smooth(points):
    result=[]; n=len(points)
    for i in range(n):
        p0=points[(i-1)%n]; p1=points[i]; p2=points[(i+1)%n]; p3=points[(i+2)%n]
        for j in range(12):
            t=j/12; t2=t*t; t3=t2*t
            result.append(tuple(.5*((2*p1[k])+(-p0[k]+p2[k])*t+(2*p0[k]-5*p1[k]+4*p2[k]-p3[k])*t2+(-p0[k]+3*p1[k]-3*p2[k]+p3[k])*t3) for k in range(2)))
    return result
paths=[smooth(A),smooth(B)]
def mat(name,color):
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True
    n=m.node_tree.nodes; n.clear(); e=n.new('ShaderNodeEmission'); e.inputs[0].default_value=(*color,1); o=n.new('ShaderNodeOutputMaterial'); m.node_tree.links.new(e.outputs[0],o.inputs[0]); return m
orange=mat('Flare orange',(1,.102,.014)); ink=mat('Ink',(.04,.045,.05)); white=mat('Warm white',(.97,.97,.955)); muted=mat('Muted',(.46,.48,.49)); dark=mat('Dark',(.035,.04,.045))
def poly(name,pts,m):
    vs=[Vector(v) for v in pts]; tris=tessellate_polygon([vs]); idx={tuple(v):i for i,v in enumerate(vs)}
    mesh=bpy.data.meshes.new(name); mesh.from_pydata(pts,[],[[v if isinstance(v,int) else idx[tuple(v)] for v in t] for t in tris]); mesh.update(); o=bpy.data.objects.new(name,mesh); bpy.context.collection.objects.link(o); o.data.materials.append(m); return o
def rect(x,y,w,h,m): poly('Panel',[(x,y,0),(x+w,y,0),(x+w,y+h,0),(x,y+h,0)],m)
def mark(x,y,s,m):
    for i,p in enumerate(paths): poly('Flare ribbon '+str(i),[(x+(a-8)/88*s,y+(117-b)/111*s*1.26,.05) for a,b in p],m)
font=bpy.data.fonts.load('/Users/josephsimo/Library/Fonts/Inter-VariableFont_opsz,wght.ttf')
def text(body,x,y,size,m):
    c=bpy.data.curves.new('Label','FONT'); c.body=body; c.font=font; c.size=size; o=bpy.data.objects.new(body,c); bpy.context.collection.objects.link(o); o.location=(x,y,.1); c.materials.append(m)
rect(-8,-5,16,10,white); rect(0,-5,8,10,dark)
text('FlareGit',-6.8,3.7,.60,ink); text('FlareGit',1.2,3.7,.60,white)
text('Independent work. Shared history.',-6.8,3.15,.20,muted); text('Independent work. Shared history.',1.2,3.15,.20,muted)
mark(-5.7,-.25,2.5,orange); mark(2.3,-.25,2.5,orange)
text('ONE COLOR',-6.8,-1.7,.14,muted); text('ONE COLOR',1.2,-1.7,.14,muted)
mark(-6.8,-2.7,.55,ink); mark(1.2,-2.7,.55,white)
text('FlareGit',-5.95,-2.45,.44,ink); text('FlareGit',2.05,-2.45,.44,white)
text('SMALL SIZE / 16 · 24 · 32 · 48 PX',-6.8,-3.45,.14,muted); text('SMALL SIZE / 16 · 24 · 32 · 48 PX',1.2,-3.45,.14,muted)
for base,m in [(-6.8,orange),(1.2,orange)]:
    for i,px in enumerate([16,24,32,48]): mark(base+i*1.1,-4.4,px/100,m)
bpy.ops.object.camera_add(location=(0,0,20)); cam=bpy.context.object; cam.data.type='ORTHO'; cam.data.ortho_scale=16; bpy.context.scene.camera=cam
scene=bpy.context.scene; scene.render.engine='BLENDER_EEVEE'; scene.render.resolution_x=1600; scene.render.resolution_y=1000; scene.render.resolution_percentage=100; scene.world.color=(1,1,1); scene.view_settings.view_transform='Standard'; scene.render.image_settings.file_format='PNG'; scene.render.filepath=os.path.join(OUT,'light-dark-size-proof.png')
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'flaregit-refinement.blend')); bpy.ops.render.render(write_still=True)
for name,fill in [('flaregit-orange.svg','#FF5A1F'),('flaregit-monochrome.svg','currentColor')]:
    d=' '.join('M'+' '.join(f'{x:.3f},{y:.3f}' for x,y in p)+'Z' for p in paths)
    open(os.path.join(OUT,name),'w').write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 104 126"><path fill="{fill}" d="{d}"/></svg>\n')
