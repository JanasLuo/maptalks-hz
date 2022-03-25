import { IS_NODE, extend, isInteger, log2 } from '../../core/util';
import { createGLContext, createProgram, enableVertexAttrib } from '../../core/util/gl';
import Browser from '../../core/Browser';
import * as mat4 from '../../core/util/mat4';
import Canvas from '../../core/Canvas';
import Point from '../../geo/Point';

const shaders = {
    'vertexShader': `
        attribute vec2 a_position;

        attribute vec2 a_texCoord;

        uniform mat4 u_matrix;

        varying vec2 v_texCoord;

        void main() {
            gl_Position = u_matrix * vec4(a_position, 0., 1.);

            v_texCoord = a_texCoord;
        }
    `,
    // fragment shader, can be replaced by layer.options.fragmentShader
    'fragmentShader': `
        precision mediump float;

        uniform sampler2D u_image;

        uniform float u_opacity;
        uniform float u_debug_line;

        varying vec2 v_texCoord;

        void main() {
            if (u_debug_line == 1.) {
                gl_FragColor = vec4(0., 1., 0., 1.);
            } else {
                gl_FragColor = texture2D(u_image, v_texCoord) * u_opacity;
            }
        }
    `
};

//reusable temporary variables
const v2 = [0, 0],
    v3 = [0, 0, 0],
    arr16 = new Array(16);
const DEBUG_POINT = new Point(20, 20);

/**
 * A mixin providing image support in WebGL env
 * @mixin ImageGLRenderable
 * @protected
 */
const ImageGLRenderable = Base => {
    const renderable = class extends Base {

        /**
         * Draw an image at x, y at map's gl zoom
         * @param {Image|Canvas} image
         * @param {Number} x - x at map's gl zoom
         * @param {Number} y - y at map's gl zoom
         * @param {Number} w - width at map's gl zoom
         * @param {Number} h - height at map's gl zoom
         * @param {Number} opacity
         */
        drawGLImage(image, x, y, w, h, scale, opacity, debug) {
            if (this.gl.program !== this.program) {
                this.useProgram(this.program);
            }
            const gl = this.gl;
            this.loadTexture(image);

            v3[0] = x || 0;
            v3[1] = y || 0;
            const uMatrix = mat4.identity(arr16);
            mat4.translate(uMatrix, uMatrix, v3);
            mat4.scale(uMatrix, uMatrix, [scale, scale, 1]);
            mat4.multiply(uMatrix, this.getMap().projViewMatrix, uMatrix);
            gl.uniformMatrix4fv(this.program['u_matrix'], false, uMatrix);
            gl.uniform1f(this.program['u_opacity'], opacity);
            gl.uniform1f(this.program['u_debug_line'], 0);

            const { glBuffer } = image;
            if (glBuffer && (glBuffer.width !== w || glBuffer.height !== h)) {
                this.saveImageBuffer(glBuffer);
                delete image.glBuffer;
            }
            if (!image.glBuffer) {
                image.glBuffer = this.bufferTileData(0, 0, w, h);
            } else {
                gl.bindBuffer(gl.ARRAY_BUFFER, glBuffer);
            }

            v2[0] = 'a_position';
            v2[1] = 2;
            v2[2] = image.glBuffer.type;
            this.enableVertexAttrib(v2); // ['a_position', 3]
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            if (debug) {
                this.drawDebug(uMatrix, v2, 0, 0, w, h, debug);
            }
        }

        drawDebug(uMatrix, attrib, x, y, w, h, debugInfo) {
            const gl = this.gl;
            gl.bindBuffer(gl.ARRAY_BUFFER, this._debugBuffer);
            this.enableVertexAttrib(['a_position', 2, 'FLOAT']);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
                x, y,
                x + w, y,
                x + w, y - h,
                x, y - h,
                x, y
            ]), gl.DYNAMIC_DRAW);
            gl.uniformMatrix4fv(this.program['u_matrix'], false, uMatrix);
            gl.uniform1f(this.program['u_debug_line'], 1);
            gl.drawArrays(gl.LINE_STRIP, 0, 5);
            //draw debug info
            let canvas = this._debugInfoCanvas;
            if (!canvas) {
                const dpr = this.getMap().getDevicePixelRatio() > 1 ? 2 : 1;
                canvas = this._debugInfoCanvas = document.createElement('canvas');
                canvas.width = 256 * dpr;
                canvas.height = 32 * dpr;
                const ctx = canvas.getContext('2d');
                ctx.font = '20px monospace';
                ctx.scale(dpr, dpr);
            }
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const color = this.layer.options['debugOutline'];
            Canvas.fillText(ctx, debugInfo, DEBUG_POINT, color);
            this.loadTexture(canvas);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
            w = 256;
            h = 32;
            const x1 = x;
            const x2 = x + w;
            const y1 = y;
            const y2 = y - h;
            gl.bufferData(gl.ARRAY_BUFFER, this.set8(
                x1, y1,
                x1, y2,
                x2, y1,
                x2, y2
            ), gl.DYNAMIC_DRAW);
            gl.uniform1f(this.program['u_debug_line'], 0);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }

        bufferTileData(x, y, w, h, buffer) {
            const x1 = x;
            const x2 = x + w;
            const y1 = y;
            const y2 = y - h;
            let data;
            if (isInteger(x1) && isInteger(x2) && isInteger(y1) && isInteger(y2)) {
                data = this.set8Int(
                    x1, y1,
                    x1, y2,
                    x2, y1,
                    x2, y2);
            } else {
                data = this.set8(
                    x1, y1,
                    x1, y2,
                    x2, y1,
                    x2, y2);
            }
            const glBuffer = this.loadImageBuffer(data, buffer);
            glBuffer.width = w;
            glBuffer.height = h;
            glBuffer.type = data instanceof Int16Array ? 'SHORT' : 'FLOAT';
            return glBuffer;
        }

        /**
         * Draw the tile image as tins
         * @param {HtmlElement} image
         * @param {Array} vertices  - tin vertices
         * @param {Array} texCoords - texture coords
         * @param {Array} indices   - element indexes
         * @param {number} opacity
         */
        drawTinImage(image, vertices, texCoords, indices, opacity) {
            const gl = this.gl;
            this.loadTexture(image);
            gl.uniformMatrix4fv(this.program['u_matrix'], false, this.getMap().projViewMatrix);
            gl.uniform1f(this.program['u_opacity'], opacity);

            //bufferdata vertices
            gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
            this.enableVertexAttrib(['a_position', 3]);
            //TODO save buffer to avoid repeatedly bufferData
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);

            //bufferdata tex coords
            gl.bindBuffer(gl.ARRAY_BUFFER, this.texBuffer);
            this.enableVertexAttrib(['a_texCoord', 2]);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texCoords), gl.DYNAMIC_DRAW);

            //bufferdata indices
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.DYNAMIC_DRAW);
            //draw
            gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
        }

        /**
         * Create another GL canvas to draw gl images
         * For layer renderer that needs 2 seperate canvases for 2d and gl
         */
        createCanvas2() {
            this.canvas2 = Canvas.createCanvas(this.canvas.width, this.canvas.height);
        }

        /**
         * Get webgl context(this.gl). It prefers canvas2, and will change to this.canvas if canvas2 is not created
         */
        createGLContext() {
            if (this.canvas.gl && this.canvas.gl.wrap) {
                this.gl = this.canvas.gl.wrap();
            } else {
                this.gl = createGLContext(this.canvas2 || this.canvas, this.layer.options['glOptions']);
            }
            const gl = this.gl;
            gl.clearColor(0.0, 0.0, 0.0, 0.0);

            gl.disable(gl.DEPTH_TEST);
            gl.enable(gl.STENCIL_TEST);

            gl.enable(gl.BLEND);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

            this.program = this.createProgram(shaders['vertexShader'], this.layer.options['fragmentShader'] || shaders['fragmentShader']);
            this._debugBuffer = this.createBuffer();

            this.useProgram(this.program);
            // input texture vec data
            this.texBuffer = this.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.texBuffer);
            this.enableVertexAttrib(['a_texCoord', 2, 'UNSIGNED_BYTE']);
            gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array([
                0.0, 0.0,
                0.0, 1.0,
                1.0, 0.0,
                1.0, 1.0
            ]), gl.STATIC_DRAW);

            this.enableSampler('u_image');

            // Enable texture unit 0
            gl.activeTexture(gl['TEXTURE0']);

            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        }

        /**
         * Resize GL canvas with renderer's 2D canvas
         */
        resizeGLCanvas() {
            if (this.gl) {
                this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
            }
            if (!this.canvas2) {
                return;
            }
            if (this.canvas2.width !== this.canvas.width || this.canvas2.height !== this.canvas.height) {
                this.canvas2.width = this.canvas.width;
                this.canvas2.height = this.canvas.height;
            }
        }

        /**
         * Clear gl canvas
         */
        clearGLCanvas() {
            if (this.gl) {
                this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.STENCIL_BUFFER_BIT);
            }
        }

        disposeImage(image) {
            if (!image) {
                return;
            }
            if (image.texture) {
                this.saveTexture(image.texture);
            }
            if (image.glBuffer) {
                this.saveImageBuffer(image.glBuffer);
            }
            delete image.texture;
            delete image.glBuffer;
        }

        _createTexture(image) {
            const gl = this.gl;
            const texture = this.getTexture() || gl.createTexture();   // Create a texture object
            // Bind the texture object to the target
            gl.bindTexture(gl.TEXTURE_2D, texture);
            // from mapbox-gl-js
            // gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
            if (isInteger(log2(image.width)) && isInteger(log2(image.width))) {
                gl.generateMipmap(gl.TEXTURE_2D);
            }

            return texture;
        }

        /**
         * Get a texture from cache or create one if cache is empty
         * @returns {WebGLTexture}
         */
        getTexture() {
            if (!this._textures) {
                this._textures = [];
            }
            const textures = this._textures;
            return textures && textures.length > 0 ? textures.pop() : null;
        }

        /**
         * Save a texture to the cache
         * @param {WebGLTexture} texture
         */
        saveTexture(texture) {
            this._textures.push(texture);
        }

        /**
         * Load image into a text and bind it with WebGLContext
         * @param {Image|Canvas} image
         * @returns {WebGLTexture}
         */
        loadTexture(image) {
            const gl = this.gl;
            let texture = image.texture;   // Create a texture object
            if (!texture) {
                texture = this._createTexture(image);
                image.texture = texture;
            }
            gl.bindTexture(gl.TEXTURE_2D, texture);
            return texture;
        }

        /**
         * Get a texture from cache or create one if cache is empty
         * @returns {WebGLTexture}
         */
        getImageBuffer() {
            if (!this._imageBuffers) {
                this._imageBuffers = [];
            }
            const imageBuffers = this._imageBuffers;
            return imageBuffers && imageBuffers.length > 0 ? imageBuffers.pop() : null;
        }

        /**
         * Save a texture to the cache
         * @param {WebGLTexture} texture
         */
        saveImageBuffer(buffer) {
            this._imageBuffers.push(buffer);
        }

        /**
         * Load image into a text and bind it with WebGLContext
         * @returns {WebGLTexture}
         */
        loadImageBuffer(data, glBuffer) {
            const gl = this.gl;
            // Create a buffer object
            const buffer = glBuffer || this.createImageBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
            gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
            return buffer;
        }

        createImageBuffer() {
            return this.getImageBuffer() || this.createBuffer();
        }

        /**
         * remove all the resources and remove gl canvas
         */
        removeGLCanvas() {
            // release resources
            const gl = this.gl;
            if (!gl) {
                return;
            }
            if (this._debugBuffer) {
                gl.deleteBuffer(this._debugBuffer);
                delete this._debugBuffer;
            }
            if (this._buffers) {
                this._buffers.forEach(function (b) {
                    gl.deleteBuffer(b);
                });
                delete this._buffers;
            }
            if (this._textures) {
                this._textures.forEach(t => gl.deleteTexture(t));
                delete this._textures;
            }
            if (this._debugInfoCanvas) {
                const texture = this._debugInfoCanvas.texture;
                if (texture) {
                    gl.deleteTexture(texture);
                }
                delete this._debugInfoCanvas.texture;
                delete this._debugInfoCanvas;
            }
            const program = gl.program;
            gl.deleteShader(program.fragmentShader);
            gl.deleteShader(program.vertexShader);
            gl.deleteProgram(program);
            delete this.gl;
            delete this.canvas2;
        }

        //----------------------- webgl utils unlike to change ---------------------------------

        /**
         * Create a WebGL buffer
         * @returns {WebGLBuffer}
         */
        createBuffer() {
            const gl = this.gl;
            // Create the buffer object
            const buffer = gl.createBuffer();
            if (!buffer) {
                throw new Error('Failed to create the buffer object');
            }
            if (!this._buffers) {
                this._buffers = [];
            }
            this._buffers.push(buffer);
            return buffer;
        }

        /**
         * Enable vertex attributes
         * @param {Array} attributes [[name, stride, type], [name, stride, type]...]
         * @example
         * rendererr.enableVertexAttrib([
         *  ['a_position', 3, 'FLOAT'],
         *  ['a_normal', 3, 'FLOAT']
         * ]);
         */
        enableVertexAttrib(attributes) {
            enableVertexAttrib(this.gl, this.gl.program, attributes);
        }

        /**
         * Create the linked program object
         * @param {String} vert a vertex shader program (string)
         * @param {String} frag a fragment shader program (string)
         * @return {WebGLProgram} created program object, or null if the creation has failed
         */
        createProgram(vert, frag) {
            const gl = this.gl;
            const { program, vertexShader, fragmentShader } = createProgram(gl, vert, frag);
            const numUniforms = gl.getProgramParameter(program, 0x8B86);
            const activeUniforms = [];
            for (let i = 0; i < numUniforms; ++i) {
                const info = gl.getActiveUniform(program, i);
                activeUniforms.push(info.name);
            }
            program.vertexShader = vertexShader;
            program.fragmentShader = fragmentShader;

            this._initUniforms(program, activeUniforms);
            return program;
        }

        /**
         * use the given program
         * @param {WebGLProgram} program
         */
        useProgram(program) {
            const gl = this.gl;
            gl.useProgram(program);
            gl.program = program;
            return this;
        }

        /**
         * Enable a sampler, and set texture
         * @param {WebGLSampler} sampler
         * @param {ptr} texture id
         */
        enableSampler(sampler, texIdx) {
            const gl = this.gl;
            const uSampler = this._getUniform(gl.program, sampler);
            if (!texIdx) {
                texIdx = 0;
            }
            // Set the texture unit to the sampler
            gl.uniform1i(uSampler, texIdx);
            return uSampler;
        }

        _initUniforms(program, uniforms) {
            for (let i = 0; i < uniforms.length; i++) {
                let name = uniforms[i];
                let uniform = uniforms[i];
                const b = name.indexOf('[');
                if (b >= 0) {
                    name = name.substring(0, b);
                    if (!IS_NODE) {
                        // In browser, remove [0] from uniforma declaration
                        uniform = uniform.substring(0, b);
                    }
                }
                program[name] = this._getUniform(program, uniform);
            }
        }

        _getUniform(program, uniformName) {
            const gl = this.gl;
            const uniform = gl.getUniformLocation(program, uniformName);
            if (!uniform) {
                throw new Error('Failed to get the storage location of ' + uniformName);
            }
            return uniform;
        }
    };

    extend(renderable.prototype, {
        set8: function () {
            const out = Browser.ie9 ? null : new Float32Array(8);
            return function (a0, a1, a2, a3, a4, a5, a6, a7) {
                out[0] = a0;
                out[1] = a1;
                out[2] = a2;
                out[3] = a3;
                out[4] = a4;
                out[5] = a5;
                out[6] = a6;
                out[7] = a7;
                return out;
            };
        }(),

        set8Int: function () {
            const out = Browser.ie9 ? null : new Int16Array(8);
            return function (a0, a1, a2, a3, a4, a5, a6, a7) {
                out[0] = a0;
                out[1] = a1;
                out[2] = a2;
                out[3] = a3;
                out[4] = a4;
                out[5] = a5;
                out[6] = a6;
                out[7] = a7;
                return out;
            };
        }()
    });

    return renderable;
};

export default ImageGLRenderable;
