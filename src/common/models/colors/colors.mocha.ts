'use strict';

import { expect } from 'chai';
import { testImmutableClass } from 'immutable-class/build/tester';

import { $, Expression } from 'plywood';
import { Colors } from './colors';

describe('Colors', () => {
  it('is an immutable class', () => {
    testImmutableClass(Colors, [
      {
        dimension: 'country',
        limit: 5
      },
      {
        dimension: 'country',
        values: { '1': 'USA', '3': 'UK', '7': 'India' }
      },
      {
        dimension: 'country',
        values: { '1': null, '3': 'UK', '7': 'India' }
      },
      {
        dimension: 'country',
        values: { '1': null, '3': 100, '7': 200 }
      },
      {
        dimension: 'country',
        values: { '1': 'USA', '3': 'UK', '8': 'India' }
      },
      {
        dimension: 'country',
        values: { '0': 'USA', '1': 'UK', '2': 'India' }
      },
      {
        dimension: 'country',
        values: { '0': 'USA', '1': 'UK', '2': 'India' },
        sameAsLimit: true
      }
    ]);
  });

  describe('workflow', () => {
    it('start, set values, add, remove, toggle', () => {
      var initColors = Colors.init('country', 5);
      var colors = initColors;

      expect(colors.toJS()).to.deep.equal({
        dimension: 'country',
        limit: 5
      });

      colors = colors.setValueEquivalent([null, 'UK', 'India', 'Russia', 'Madagascar']);

      expect(colors.toJS()).to.deep.equal({
        "dimension": "country",
        "sameAsLimit": true,
        "values": {
          "0": null,
          "1": "UK",
          "2": "India",
          "3": "Russia",
          "4": "Madagascar"
        }
      });

      expect(colors.equivalentToLimit(initColors)).to.equal(true);
      expect(initColors.equivalentToLimit(colors)).to.equal(false);

      expect(colors.has(null), 'has null').to.equal(true);

      expect(colors.has('South Africa'), 'no SA').to.equal(false);

      colors = colors.add('South Africa');

      expect(colors.has('South Africa')).to.equal(true);

      expect(colors.toJS()).to.deep.equal({
        "dimension": "country",
        "values": {
          "0": null,
          "1": "UK",
          "2": "India",
          "3": "Russia",
          "4": "Madagascar",
          "5": "South Africa"
        }
      });

      colors = colors.remove('UK');

      expect(colors.toJS()).to.deep.equal({
        "dimension": "country",
        "values": {
          "0": null,
          "2": "India",
          "3": "Russia",
          "4": "Madagascar",
          "5": "South Africa"
        }
      });

      colors = colors.add('Australia');

      expect(colors.toJS()).to.deep.equal({
        "dimension": "country",
        "values": {
          "0": null,
          "1": "Australia",
          "2": "India",
          "3": "Russia",
          "4": "Madagascar",
          "5": "South Africa"
        }
      });

      var colorsWithGap = colors.remove("Australia");
      expect(colors.equals(colorsWithGap)).to.equal(false);
      expect(colorsWithGap.equals(colors)).to.equal(false);
    });
  });

});
