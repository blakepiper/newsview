import assert from 'node:assert/strict';
import test from 'node:test';
import { getFeedItemMaxAge, isScientistSource } from '../src/utils/formatters.ts';

test('extends the publication window only for monitored scientists', () => {
  const day = 24 * 60 * 60 * 1000;
  for (const name of ['Karl Friston', 'Michael Levin', 'Chris Fields', 'Geoffrey Hinton', 'Yann LeCun', 'Percy Liang', 'Stuart Russell', 'Yoshua Bengio', 'Fei-Fei Li', 'Yejin Choi', 'Dawn Song', 'Chris Olah', 'Neel Nanda', 'Paul Christiano', 'Dan Hendrycks', 'Myles Allen', 'Piers Forster', 'Gavin Schmidt', 'Friederike Otto', 'Richard Alley', 'Corinne Le Quéré', 'Marshall Burke', 'Jesse Jenkins', 'Michael Mann', 'Zeke Hausfather', 'Matt Kaeberlein', 'Valter Longo', 'David Sinclair', 'Steve Horvath', 'Michael Snyder', 'Herman Pontzer', 'Vishwa Deep Dixit', 'Rhonda Patrick', 'Peter Attia', 'Chris Masterjohn', 'Lisa Kaltenegger', 'Nikku Madhusudhan', 'Sara Seager', 'David Kipping', 'Victoria Meadows', 'Ravi Kopparapu', 'Jessie Christiansen', 'Kevin Hand', 'Sara Imari Walker', 'Jason Wright', 'Jennifer Doudna', 'Feng Zhang', 'David Liu', 'George Church', 'Jay Keasling', 'James Collins', 'Pamela Silver', 'Drew Endy', 'Timothy Lu', 'Cameron Myhrvold']) {
    assert.equal(isScientistSource(name), true);
    assert.equal(getFeedItemMaxAge(name), 180 * day);
  }
  for (const name of ['ScienceDaily', 'Nature', 'NPR', 'Someone Else']) {
    assert.equal(isScientistSource(name), false);
    assert.equal(getFeedItemMaxAge(name), 7 * day);
  }
});
