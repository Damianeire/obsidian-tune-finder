import { test } from "node:test";
import assert from "node:assert/strict";
import { displayName, nameKey, namesMatch } from "../src/names.ts";

test("nameKey ignores articles, tune types, accents, apostrophes and numbers as digits", () => {
	assert.equal(nameKey("The Silver Spear"), nameKey("silver spear, the"));
	assert.equal(nameKey("Silver Spear Reel"), nameKey("The Silver Spear"));
	assert.equal(nameKey("Nóra Críonna"), nameKey("Nora Crionna"));
	assert.equal(nameKey("Anderson’s"), nameKey("Anderson's"));
	assert.equal(nameKey("9 points of knavery"), nameKey("The Nine Points of Knavery"));
	assert.equal(nameKey("Adam & Eve"), nameKey("Adam and Eve"));
});

test("namesMatch: exact keys, close spellings, and nothing looser", () => {
	assert.ok(namesMatch("The Blackberry Blossom", "Blackberry Blossum"));
	assert.ok(namesMatch("Adam and Eve's", "adam and eve"));
	assert.ok(!namesMatch("Ballydesmond No. 1", "Ballydesmond No. 2"));
	assert.ok(!namesMatch("The Kesh", "The Kerry"));
	assert.ok(!namesMatch("Lucy Farr's", "Joshua Dukes - Lucy FarrsHills of Tara"));
	assert.ok(namesMatch("Lucy Farr's", "Joshua Dukes - Lucy FarrsHills of Tara", { allowContains: true }));
});

test("displayName turns FolkFriend aliases into titles", () => {
	assert.equal(displayName("soup dragon, the"), "The Soup Dragon");
	assert.equal(displayName("kevin mchugh's"), "Kevin McHugh's");
	assert.equal(displayName("o'neill's march"), "O'Neill's March");
	assert.equal(displayName("the boys of the town"), "The Boys of the Town");
	assert.equal(displayName("paddy fahey's no. 2"), "Paddy Fahey's No. 2");
});
