package com.sashplatonov.habbit.runner.auth.support;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

public enum ThemeId {
  CLOUD("cloud"), PEACH("peach"), MINT("mint"), LAVENDER("lavender"), PAPER("paper"),
  MIDNIGHT("midnight"), GRAPHITE("graphite"), EMBER("ember"), VIOLET("violet"), MATRIX("matrix"),
  ARCTIC("arctic"), AURORA("aurora"), DUNE("dune"), LAGOON("lagoon"), SAKURA("sakura");

  private final String wireValue;

  ThemeId(String wireValue) { this.wireValue = wireValue; }

  @JsonValue
  public String wireValue() { return wireValue; }

  @JsonCreator
  public static ThemeId fromWireValue(String value) {
    for (var candidate : values()) {
      if (candidate.wireValue.equals(value)) {
        return candidate;
      }
    }
    return CLOUD;
  }
}
