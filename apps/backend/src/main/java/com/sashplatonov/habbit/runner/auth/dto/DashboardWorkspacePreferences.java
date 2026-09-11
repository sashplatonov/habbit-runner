package com.sashplatonov.habbit.runner.auth.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

@JsonIgnoreProperties(ignoreUnknown = true)
public record DashboardWorkspacePreferences(
    DashboardFilter filter,
    String searchQuery,
    List<String> tags,
    DashboardSort sort,
    DashboardDensity density
) {
  public DashboardWorkspacePreferences {
    filter = filter == null ? DashboardFilter.PENDING : filter;
    searchQuery = searchQuery == null ? "" : searchQuery;
    tags = Collections.unmodifiableList(new ArrayList<>(tags == null ? List.of() : tags));
    sort = sort == null ? DashboardSort.CUSTOM : sort;
    density = density == null ? DashboardDensity.COMFORTABLE : density;
  }

  @Override
  public List<String> tags() {
    return Collections.unmodifiableList(new ArrayList<>(tags));
  }

  public DashboardWorkspacePreferences() {
    this(DashboardFilter.PENDING, "", List.of(), DashboardSort.CUSTOM, DashboardDensity.COMFORTABLE);
  }
}
