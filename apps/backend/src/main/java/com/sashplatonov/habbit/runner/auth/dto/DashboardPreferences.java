package com.sashplatonov.habbit.runner.auth.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.List;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

@JsonIgnoreProperties(ignoreUnknown = true)
public record DashboardPreferences(
    Integer version,
    String filter,
    List<String> tags,
    String sort,
    String density,
    Map<String, Integer> themeUsage
) {
  public DashboardPreferences {
    tags = Collections.unmodifiableList(new ArrayList<>(tags == null ? List.of() : tags));
    themeUsage = Collections.unmodifiableMap(
        new LinkedHashMap<>(themeUsage == null ? Map.of() : themeUsage)
    );
  }

  @Override
  public List<String> tags() {
    return Collections.unmodifiableList(new ArrayList<>(tags));
  }

  @Override
  public Map<String, Integer> themeUsage() {
    return Collections.unmodifiableMap(new LinkedHashMap<>(themeUsage));
  }

  public DashboardPreferences() {
    this(1, "pending", List.of(), "custom", "comfortable", Map.of());
  }
}
