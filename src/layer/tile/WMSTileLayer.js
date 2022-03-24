import { extend } from '../../core/util';
import TileLayer from './TileLayer';

/**
 * @property {Object}              options                     - TileLayer's options
 * @property {String}              [options.service=WMS]       - WMS Service
 * @property {String}              options.layers              - Comma-separated list of WMS layers to show.
 * @property {String}              [options.styles='']         - Comma-separated list of WMS styles.
 * @property {String}              [options.format=image/jpeg] - WMS image format (use `'image/png'` for layers with transparency).
 * @property {String}              [options.transparent=false] - Version of the WMS service to use
 * @property {String}              [options.version=1.1.1]     - size of the tile image
 * @property {String}              [options.crs=null]          - Coordinate Reference System to use for the WMS requests, defaults to map CRS. Don't change this if you're not sure what it means.
 * @property {Boolean}             [options.uppercase=false]   - If `true`, WMS request parameter keys will be uppercase.
 * @property {Boolean}             [options.detectRetina=false]   - If `true` and user is on a retina display, it will request four tiles of half the specified size and a bigger zoom level in place of one to utilize the high resolution.
 * @memberOf WMSTileLayer
 * @instance
 */
const options = {
    crs: null,
    uppercase: false,
    detectRetina : false
};

const defaultWmsParams = {
    service: 'WMS',
    request: 'GetMap',
    layers: '',
    styles: '',
    format: 'image/jpeg',
    transparent: false,
    version: '1.1.1'
};

/**
 * @classdesc
 * Used to display [WMS]{https://en.wikipedia.org/wiki/Web_Map_Service} services as tile layers on the map. Extends [TileLayer]{@link TileLayer}.
 * Implemented based on Leaflet's TileLayer.WMS.
 * @category layer
 * @extends TileLayer
 * @param {String|Number} id - tile layer's id
 * @param {Object} [options=null] - options defined in [WMSTileLayer]{@link TileLayer#options}
 * @example
 * var layer = new maptalks.WMSTileLayer('wms', {
 *     'urlTemplate' : 'https://demo.boundlessgeo.com/geoserver/ows',
 *     'crs' : 'EPSG:3857',
 *     'layers' : 'ne:ne',
 *     'styles' : '',
 *     'version' : '1.3.0',
 *     'format': 'image/png',
 *     'transparent' : true,
 *     'uppercase' : true
 * });
 */
class WMSTileLayer extends TileLayer {

    constructor(id, options) {
        super(id);
        const wmsParams = extend({}, defaultWmsParams);
        for (const p in options) {
            if (!(p in this.options)) {
                wmsParams[p] = options[p];
            }
        }
        this.setOptions(options);
        this.setZIndex(options.zIndex);
        const tileSize = this.getTileSize();
        wmsParams.width = tileSize.width;
        wmsParams.height = tileSize.height;
        this.wmsParams = wmsParams;
        this._wmsVersion = parseFloat(wmsParams.version);
    }

    onAdd() {
        const dpr = this.getMap().getDevicePixelRatio();
        const r = options.detectRetina ? dpr : 1;
        this.wmsParams.width *= r;
        this.wmsParams.height *= r;
        const crs = this.options.crs || this.getMap().getProjection().code;
        const projectionKey = this._wmsVersion >= 1.3 ? 'crs' : 'srs';
        this.wmsParams[projectionKey] = crs;
        super.onAdd();
    }

    getTileUrl(x, y, z) {
        const res = this.getSpatialReference().getResolution(z),
            tileConfig = this._getTileConfig(),
            tileExtent = tileConfig.getTilePrjExtent(x, y, res);
        const max = tileExtent.getMax(),
            min = tileExtent.getMin();

        let url = super.getTileUrl(x, y, z);
        url += getParamString(this.wmsParams, url, this.options.uppercase) 
        if(this.wmsParams.layers !== 'supermap') {
          const bbox = (this._wmsVersion >= 1.3 && this.wmsParams.crs === 'EPSG:4326' ?
          [min.y, min.x, max.y, max.x] :
          [min.x, min.y, max.x, max.y]).join(',');
          url += (this.options.uppercase ? '&BBOX=' : '&bbox=') + bbox
        } else { // 对接超图iServer服务
          const scale = this.getDefaultScale(max, min);
          url += "&scale=" + scale + "&x=" + x + "&y=" + y;
        }
        return url
    }
     /**
   * @description 获取默认比例尺信息。
   */
      getDefaultScale(max,min) {
        var ne = max;
        var sw = min;
        var tileSize = this.wmsParams.height;
        var resolution = Math.max(
          Math.abs(ne.x - sw.x) / tileSize,
          Math.abs(ne.y - sw.y) / tileSize
        );
        var mapUnit = Unit.METER;
        var crs = this.wmsParams.crs
        if (crs) {
          var array = crs.split(':');
          if (array && array.length > 1) {
            var code = parseInt(array[1]);
            mapUnit = code && code >= 4000 && code <= 5000 ? Unit.DEGREE : Unit.METER;
          }
        }
        return this._resolutionToScale(resolution, 96, mapUnit);
      }
  
      _resolutionToScale(resolution, dpi, mapUnit) {
        var inchPerMeter = 1 / 0.0254;
        // 地球半径。
        var meterPerMapUnit = this._getMeterPerMapUnit(mapUnit);
        var scale = resolution * dpi * inchPerMeter * meterPerMapUnit;
        scale = 1 / scale;
        return scale;
      }
      _getMeterPerMapUnit(mapUnit) {
        var earchRadiusInMeters = 6378137;
        var meterPerMapUnit;
        if (mapUnit === Unit.METER) {
            meterPerMapUnit = 1;
        } else if (mapUnit === Unit.DEGREE) {
            // 每度表示多少米。
            meterPerMapUnit = (Math.PI * 2 * earchRadiusInMeters) / 360;
        } else if (mapUnit === Unit.KILOMETER) {
            meterPerMapUnit = 1.0e-3;
        } else if (mapUnit === Unit.INCH) {
            meterPerMapUnit = 1 / 2.5399999918e-2;
        } else if (mapUnit === Unit.FOOT) {
            meterPerMapUnit = 0.3048;
        } else {
            return meterPerMapUnit;
        }
        return meterPerMapUnit;
    }
    /**
     * Export the WMSTileLayer's json. <br>
     * It can be used to reproduce the instance by [fromJSON]{@link Layer#fromJSON} method
     * @return {Object} layer's JSON
     */
    toJSON() {
        return {
            'type': 'WMSTileLayer',
            'id': this.getId(),
            'options': this.config()
        };
    }

    /**
     * Reproduce a WMSTileLayer from layer's JSON.
     * @param  {Object} layerJSON - layer's JSON
     * @return {WMSTileLayer}
     * @static
     * @private
     * @function
     */
    static fromJSON(layerJSON) {
        if (!layerJSON || layerJSON['type'] !== 'WMSTileLayer') {
            return null;
        }
        return new WMSTileLayer(layerJSON['id'], layerJSON['options']);
    }
}

WMSTileLayer.registerJSONType('WMSTileLayer');

WMSTileLayer.mergeOptions(options);

export default WMSTileLayer;

// From Leaflet
// Converts an object into a parameter URL string, e.g. `{a: "foo", b: "bar"}`
// translates to `'?a=foo&b=bar'`. If `existingUrl` is set, the parameters will
// be appended at the end. If `uppercase` is `true`, the parameter names will
// be uppercased (e.g. `'?A=foo&B=bar'`)
export function getParamString(obj, existingUrl, uppercase) {
    const params = [];
    for (const i in obj) {
        params.push(encodeURIComponent(uppercase ? i.toUpperCase() : i) + '=' + encodeURIComponent(obj[i]));
    }
    return ((!existingUrl || existingUrl.indexOf('?') === -1) ? '?' : '&') + params.join('&');
}
