// Page-local GPU spatial indexing. 256 Morton buckets, no CPU key readback.
// Rank reservation is unordered, but painter order is the immutable entity ID.
struct Header {origin:vec4<f32>,counts:vec4<u32>,extra:vec4<u32>}
@group(0) @binding(0) var<uniform> header:Header;
@group(0) @binding(1) var<storage,read_write> bounds:array<vec4<f32>>;
@group(0) @binding(2) var<storage,read_write> order:array<u32>;
@group(0) @binding(3) var<storage,read_write> ranks:array<vec2<u32>>;
@group(0) @binding(4) var<storage,read_write> buckets:array<atomic<u32>>;
@compute @workgroup_size(256)
fn spatialClear(@builtin(local_invocation_index) lane:u32){atomicStore(&buckets[lane],0u);atomicStore(&buckets[256u+lane],0u);}
fn spread4(v:u32)->u32{var x=v&15u;x=(x|(x<<2u))&51u;x=(x|(x<<1u))&85u;return x;}
@compute @workgroup_size(128)
fn spatialAssign(@builtin(global_invocation_id) id:vec3<u32>){let i=id.x;if(i>=header.counts.x){return;}let root=bounds[header.counts.x+header.counts.y];let b=bounds[i];let center=(b.xy+b.zw)*.5;let unit=clamp((center-root.xy)/max(root.zw-root.xy,vec2<f32>(1e-12)),vec2<f32>(0.),vec2<f32>(.999999));let xy=vec2<u32>(unit*16.);let bucket=spread4(xy.x)|(spread4(xy.y)<<1u);let rank=atomicAdd(&buckets[bucket],1u);ranks[i]=vec2<u32>(bucket,rank);}
var<workgroup> scan:array<u32,256>;
@compute @workgroup_size(256)
fn spatialScan(@builtin(local_invocation_index) lane:u32){let own=atomicLoad(&buckets[lane]);scan[lane]=own;workgroupBarrier();for(var offset=1u;offset<256u;offset*=2u){var v=0u;if(lane>=offset){v=scan[lane-offset];}workgroupBarrier();scan[lane]+=v;workgroupBarrier();}atomicStore(&buckets[256u+lane],scan[lane]-own);}
@compute @workgroup_size(128)
fn spatialScatter(@builtin(global_invocation_id) id:vec3<u32>){let i=id.x;if(i>=header.counts.x){return;}let rank=ranks[i];order[atomicLoad(&buckets[256u+rank.x])+rank.y]=i;}
var<workgroup> lo:array<vec2<f32>,128>;
var<workgroup> hi:array<vec2<f32>,128>;
@compute @workgroup_size(128)
fn spatialBounds(@builtin(global_invocation_id) id:vec3<u32>,@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) group:vec3<u32>){var b=vec4<f32>(1e30,1e30,-1e30,-1e30);if(id.x<header.counts.x){b=bounds[order[id.x]];}lo[lane]=b.xy;hi[lane]=b.zw;workgroupBarrier();for(var stride=64u;stride>0u;stride/=2u){if(lane<stride){lo[lane]=min(lo[lane],lo[lane+stride]);hi[lane]=max(hi[lane],hi[lane+stride]);}workgroupBarrier();}if(lane==0u){bounds[header.counts.x+group.x]=vec4<f32>(lo[0],hi[0]);}}
