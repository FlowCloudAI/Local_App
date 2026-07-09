/**
 * 距离场纹理生成器
 *
 * 使用 Jump Flooding Algorithm (JFA) 计算每个像素到最近海岸线的距离。
 * 这是 Shader 优化的核心：预计算距离场后，多个 shader 可以复用。
 */

import { Application, Filter, GlProgram, RenderTexture, Sprite, Texture, UniformGroup } from 'pixi.js'

/**
 * Jump Flooding Algorithm Shader
 *
 * 每个 pass 检查周围 8 个邻居（距离为 stepSize），更新到最近种子点的引用。
 */
const defaultVertexShader = `
in vec2 aPosition;
out vec2 vTextureCoord;

uniform mat3 uProjectionMatrix;
uniform mat3 uTextureMatrix;

void main() {
    gl_Position = vec4((uProjectionMatrix * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
    vTextureCoord = (uTextureMatrix * vec3(aPosition, 1.0)).xy;
}
`

const jumpFloodingShader = `
precision highp float;

uniform sampler2D uTexture;
uniform float u_stepSize;
uniform vec2 u_resolution;

varying vec2 vTextureCoord;

void main() {
  vec2 bestSeed = texture2D(uTexture, vTextureCoord).xy;
  float bestDist = 1e10;

  // 如果当前已有有效种子，计算距离
  if (bestSeed.x >= 0.0) {
    bestDist = distance(gl_FragCoord.xy, bestSeed * u_resolution);
  }

  // 检查 8 个邻居（上下左右 + 4 个对角）
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      if (dx == 0 && dy == 0) continue;

      vec2 offset = vec2(float(dx), float(dy)) * u_stepSize;
      vec2 sampleCoord = vTextureCoord + offset / u_resolution;

      // 边界检查
      if (sampleCoord.x < 0.0 || sampleCoord.x > 1.0 ||
          sampleCoord.y < 0.0 || sampleCoord.y > 1.0) continue;

      vec2 neighborSeed = texture2D(uTexture, sampleCoord).xy;

      // 跳过无效种子
      if (neighborSeed.x < 0.0) continue;

      float dist = distance(gl_FragCoord.xy, neighborSeed * u_resolution);
      if (dist < bestDist) {
        bestDist = dist;
        bestSeed = neighborSeed;
      }
    }
  }

  // 存储最近海岸点的归一化坐标（-1 表示无效）
  gl_FragColor = vec4(bestSeed, 0.0, 1.0);
}
`

/**
 * 距离计算 Shader
 *
 * 根据种子点坐标计算实际距离，归一化到 0-1 范围。
 */
const distanceFieldFinalShader = `
precision highp float;

uniform sampler2D u_seedTexture;
uniform vec2 u_resolution;

varying vec2 vTextureCoord;

void main() {
  vec2 seed = texture2D(u_seedTexture, vTextureCoord).xy;

  // 无效种子返回最大距离
  if (seed.x < 0.0) {
    gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
    return;
  }

  float dist = distance(gl_FragCoord.xy, seed * u_resolution);

  // 归一化距离（0-1），最大距离设为对角线长度
  float maxDist = length(u_resolution);
  float normalizedDist = clamp(dist / maxDist, 0.0, 1.0);

  gl_FragColor = vec4(vec3(normalizedDist), 1.0);
}
`

/**
 * 生成种子纹理：海岸线像素存储自身坐标，其他像素为 (-1, -1)
 */
function createSeedTexture(
    shapes: Array<{ polygon: [number, number][] }>,
    width: number,
    height: number
): HTMLCanvasElement {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('Failed to get 2D context')

    // 绘制陆地遮罩
    ctx.fillStyle = '#fff'
    for (const shape of shapes) {
        if (shape.polygon.length < 3) continue
        ctx.beginPath()
        ctx.moveTo(shape.polygon[0][0], shape.polygon[0][1])
        for (let i = 1; i < shape.polygon.length; i++) {
            ctx.lineTo(shape.polygon[i][0], shape.polygon[i][1])
        }
        ctx.closePath()
        ctx.fill()
    }

    // 检测边缘像素（边界 = 陆地像素且周围有非陆地像素）
    const imageData = ctx.getImageData(0, 0, width, height)
    const seedData = ctx.createImageData(width, height)

    // 初始化为无效种子 (-1, -1) → 编码为 (0, 0)，因为纹理是 0-1 范围
    for (let i = 0; i < seedData.data.length; i += 4) {
        seedData.data[i] = 0     // R: x = 0 表示 -1（无效）
        seedData.data[i + 1] = 0 // G: y = 0 表示 -1（无效）
        seedData.data[i + 2] = 0
        seedData.data[i + 3] = 255
    }

    // 标记边缘像素
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4
            const isLand = imageData.data[idx] > 128

            if (isLand) {
                // 检查周围 8 个像素
                let isBoundary = false
                for (let dy = -1; dy <= 1 && !isBoundary; dy++) {
                    for (let dx = -1; dx <= 1 && !isBoundary; dx++) {
                        if (dx === 0 && dy === 0) continue
                        const nx = x + dx
                        const ny = y + dy
                        if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
                            isBoundary = true
                            break
                        }
                        const nidx = (ny * width + nx) * 4
                        if (imageData.data[nidx] <= 128) {
                            isBoundary = true
                        }
                    }
                }

                if (isBoundary) {
                    // 存储归一化坐标 (x/width, y/height) → 映射到 0-255
                    seedData.data[idx] = Math.floor((x / width) * 255)
                    seedData.data[idx + 1] = Math.floor((y / height) * 255)
                    seedData.data[idx + 2] = 0
                    seedData.data[idx + 3] = 255
                }
            }
        }
    }

    ctx.putImageData(seedData, 0, 0)
    return canvas
}

/**
 * 执行 Jump Flooding passes
 */
function jumpFloodingPasses(
    seedTexture: Texture,
    width: number,
    height: number
): Texture {
    // 创建临时 Pixi 应用（复用同一个可以优化性能）
    const app = new Application()

    let currentTexture = seedTexture
    const maxSteps = Math.ceil(Math.log2(Math.max(width, height)))

    for (let step = 0; step < maxSteps; step++) {
        const stepSize = Math.pow(2, maxSteps - step - 1)

        const jumpFilter = new Filter({
            glProgram: GlProgram.from({
                vertex: defaultVertexShader,
                fragment: jumpFloodingShader,
            }),
            resources: {
                uniforms: new UniformGroup({
                    u_stepSize: { value: stepSize, type: 'f32' },
                    u_resolution: { value: [width, height], type: 'vec2<f32>' },
                }),
            },
        })

        const renderTexture = RenderTexture.create({ width, height })
        const sprite = new Sprite(currentTexture)
        sprite.filters = [jumpFilter]

        app.renderer.render({ container: sprite, target: renderTexture })

        // 释放旧纹理（除了初始种子纹理）
        if (currentTexture !== seedTexture) {
            currentTexture.destroy(true)
        }

        currentTexture = renderTexture
    }

    return currentTexture
}

/**
 * 生成距离场纹理
 *
 * @param shapes 陆地多边形数组
 * @param sceneWidth 场景宽度
 * @param sceneHeight 场景高度
 * @param scale 超采样倍数（默认 2）
 * @returns 距离场纹理（灰度图，值越大距离越远）
 */
export function generateDistanceFieldTexture(
    shapes: Array<{ polygon: [number, number][] }>,
    sceneWidth: number,
    sceneHeight: number,
    scale: number = 2
): Texture {
    const physWidth = Math.round(sceneWidth * scale)
    const physHeight = Math.round(sceneHeight * scale)

    // 1. 生成种子纹理（边界像素）
    const seedCanvas = createSeedTexture(shapes, physWidth, physHeight)
    const seedTexture = Texture.from(seedCanvas)

    // 2. 执行 Jump Flooding
    const jfaResult = jumpFloodingPasses(seedTexture, physWidth, physHeight)

    // 3. 计算最终距离场
    const app = new Application()
    const distanceFilter = new Filter({
        glProgram: GlProgram.from({
            vertex: defaultVertexShader,
            fragment: distanceFieldFinalShader,
        }),
        resources: {
            uniforms: new UniformGroup({
                u_resolution: { value: [physWidth, physHeight], type: 'vec2<f32>' },
            }),
        },
    })

    const finalTexture = RenderTexture.create({ width: physWidth, height: physHeight })
    const sprite = new Sprite(jfaResult)
    sprite.filters = [distanceFilter]
    app.renderer.render({ container: sprite, target: finalTexture })

    // 清理中间纹理
    seedTexture.destroy(true)
    jfaResult.destroy(true)

    return finalTexture
}

/**
 * 生成陆地遮罩纹理（简单版本：白色=陆地，黑色=海洋）
 */
export function generateLandMaskTexture(
    shapes: Array<{ polygon: [number, number][] }>,
    sceneWidth: number,
    sceneHeight: number,
    scale: number = 2
): Texture {
    const physWidth = Math.round(sceneWidth * scale)
    const physHeight = Math.round(sceneHeight * scale)

    const canvas = document.createElement('canvas')
    canvas.width = physWidth
    canvas.height = physHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Failed to get 2D context')

    // 绘制陆地为白色
    ctx.fillStyle = '#ffffff'
    for (const shape of shapes) {
        if (shape.polygon.length < 3) continue
        ctx.beginPath()
        ctx.moveTo(shape.polygon[0][0] * scale, shape.polygon[0][1] * scale)
        for (let i = 1; i < shape.polygon.length; i++) {
            ctx.lineTo(shape.polygon[i][0] * scale, shape.polygon[i][1] * scale)
        }
        ctx.closePath()
        ctx.fill()
    }

    return Texture.from(canvas)
}
