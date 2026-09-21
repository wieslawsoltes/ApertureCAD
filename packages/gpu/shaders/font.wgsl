@group(0) @binding(0) var<storage,read> fontData:array<u32>;
@group(0) @binding(1) var<uniform> fontInfo:FontInfo;
@group(0) @binding(2) var atlasOut:texture_storage_2d<rgba8unorm,write>;
// @font-common
@compute @workgroup_size(8,8)
fn bake(@builtin(global_invocation_id) id:vec3<u32>){if(id.x>=fontInfo.atlas.x||id.y>=fontInfo.atlas.y){return;}let cell=u32(fontInfo.metrics.y);let columns=u32(fontInfo.metrics.z);let gid=(id.y/cell)*columns+id.x/cell;if(gid>=fontInfo.atlas.z){textureStore(atlasOut,vec2<i32>(id.xy),vec4<f32>(0.));return;}
 let g=glyphAt(gid);let uv=(vec2<f32>(id.xy%cell)+.5)/f32(cell);let p=mix(g.box.xy,g.box.zw,vec2<f32>(uv.x,1.-uv.y));let scale=f32(cell)/max(g.box.z-g.box.x,g.box.w-g.box.y);let d=glyphDistance(g,p,scale);let v=clamp(.5+d*4.,0.,1.);textureStore(atlasOut,vec2<i32>(id.xy),vec4<f32>(v,v,v,1.));}
