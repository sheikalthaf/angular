/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {DtsMetadataReader} from '@angular/compiler-cli/src/ngtsc/metadata';
import {TypeScriptReflectionHost} from '@angular/compiler-cli/src/ngtsc/reflection';
import {confirmAsSerializable} from '../helpers/serializable';
import {TsurgeComplexMigration} from '../migration';
import {ProgramInfo} from '../program_info';
import {Replacement, TextUpdate} from '../replacement';
import {findOutputDeclarationsAndReferences, OutputID} from './output_helpers';
import {projectFile} from '../project_paths';

type AnalysisUnit = {[id: OutputID]: {seenProblematicUsage: boolean}};
type GlobalMetadata = {[id: OutputID]: {canBeMigrated: boolean}};

/**
 * A `Tsurge` migration that can migrate instances of `@Output()` to
 * the new `output()` API.
 *
 * Note that this is simply a testing construct for now, to verify the migration
 * framework works as expected. This is **not a full migration**, but rather an example.
 */
export class OutputMigration extends TsurgeComplexMigration<AnalysisUnit, GlobalMetadata> {
  override async analyze(info: ProgramInfo) {
    const program = info.program;
    const typeChecker = program.getTypeChecker();
    const reflector = new TypeScriptReflectionHost(typeChecker, false);
    const dtsReader = new DtsMetadataReader(typeChecker, reflector);

    const {sourceOutputs, problematicReferencedOutputs} = findOutputDeclarationsAndReferences(
      info,
      typeChecker,
      reflector,
      dtsReader,
    );

    const discoveredOutputs: AnalysisUnit = {};
    for (const id of sourceOutputs.keys()) {
      discoveredOutputs[id] = {seenProblematicUsage: false};
    }
    for (const id of problematicReferencedOutputs) {
      discoveredOutputs[id] = {seenProblematicUsage: true};
    }

    // Here we confirm it as serializable..
    return confirmAsSerializable(discoveredOutputs);
  }

  override async merge(data: AnalysisUnit[]) {
    const merged: GlobalMetadata = {};

    // Merge information from all compilation units. Mark
    // outputs that cannot be migrated due to seen problematic usages.
    for (const unit of data) {
      for (const [idStr, info] of Object.entries(unit)) {
        const id = idStr as OutputID;
        const existing = merged[id];

        if (existing === undefined) {
          merged[id] = {canBeMigrated: info.seenProblematicUsage === false};
        } else if (existing.canBeMigrated && info.seenProblematicUsage) {
          merged[id].canBeMigrated = false;
        }
      }
    }

    // merge units into global metadata.
    return confirmAsSerializable(merged);
  }

  override async migrate(globalAnalysisData: GlobalMetadata, info: ProgramInfo) {
    const program = info.program;
    const typeChecker = program.getTypeChecker();
    const reflector = new TypeScriptReflectionHost(typeChecker, false);
    const dtsReader = new DtsMetadataReader(typeChecker, reflector);

    const {sourceOutputs} = findOutputDeclarationsAndReferences(
      info,
      typeChecker,
      reflector,
      dtsReader,
    );
    const replacements: Replacement[] = [];

    for (const [id, node] of sourceOutputs.entries()) {
      // Output cannot be migrated as per global analysis metadata; skip.
      if (globalAnalysisData[id].canBeMigrated === false) {
        continue;
      }

      replacements.push(
        new Replacement(
          projectFile(node.getSourceFile(), info),
          new TextUpdate({
            position: node.getStart(),
            end: node.getStart(),
            toInsert: `// TODO: Actual migration logic\n`,
          }),
        ),
      );
    }

    return replacements;
  }
}