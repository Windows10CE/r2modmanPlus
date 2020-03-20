import * as yaml from 'yaml';
import Profile from 'src/model/Profile';

import * as fs from 'fs-extra';
import * as path from 'path';
import FileNotFoundError from 'src/model/errors/FileNotFoundError';
import R2Error from 'src/model/errors/R2Error';
import YamlParseError from 'src/model/errors/Yaml/YamlParseError';
import YamlConvertError from 'src/model/errors/Yaml/YamlConvertError';
import FileWriteError from 'src/model/errors/FileWriteError';
import ManifestV2 from 'src/model/ManifestV2';
import ExportFormat from 'src/model/exports/ExportFormat';
import ExportMod from 'src/model/exports/ExportMod';
import { spawn } from 'child_process';
import PathResolver from '../manager/PathResolver';
import AdmZip from 'adm-zip';

export default class ProfileModList {

    public static getModList(profile: Profile): ManifestV2[] | R2Error {
        if (!fs.existsSync(path.join(profile.getPathOfProfile(), 'mods.yml'))) {
            fs.writeFileSync(path.join(profile.getPathOfProfile(), 'mods.yml'), JSON.stringify([]));
        }
        try {
            const buf: Buffer = fs.readFileSync(
                path.join(profile.getPathOfProfile(), 'mods.yml')
            );
            try {
                const modList: ManifestV2[] = yaml.parse(buf.toString())
                    .map((mod: ManifestV2) => new ManifestV2().fromReactive(mod));
                return modList;
            } catch(e) {
                const err: Error = e;
                return new YamlParseError(
                    `Failed to parse yaml file of profile: ${profile.getProfileName()}/mods.yml`,
                    err.message
                );
            }
        } catch(e) {
            const err: Error = e;
            return new FileNotFoundError(
                'Unable to locate file',
                err.message
            )
        }
    }

    private static saveModList(profile: Profile, modList: ManifestV2[]): R2Error | null {
        try {
            const yamlModList: string = yaml.stringify(modList);
            try {
                fs.writeFileSync(
                    path.join(profile.getPathOfProfile(), 'mods.yml'),
                    yamlModList
                );
            } catch(e) {
                const err: Error = e;
                return new FileWriteError(
                    `Failed to create mods.yml for profile: ${profile.getProfileName()}`,
                    err.message
                )
            }
        } catch(e) {
            const err: Error = e;
            return new YamlConvertError(
                'Failed to convert modLiist to yaml',
                err.message
            );
        }
        return null;
    }

    public static addMod(mod: ManifestV2): ManifestV2[] | R2Error {
        let currentModList: ManifestV2[] | R2Error = this.getModList(Profile.getActiveProfile());
        if (currentModList instanceof R2Error) {
            currentModList = [];
        }
        const modIndex: number = currentModList.findIndex((search: ManifestV2) => search.getName() === mod.getName());
        this.removeMod(mod);
        currentModList = this.getModList(Profile.getActiveProfile());
        if (currentModList instanceof R2Error) {
            currentModList = [];
        }
        if (modIndex >= 0) {
            currentModList.splice(modIndex, 0, mod);
        } else {
            currentModList.push(mod);
        }
        const saveError: R2Error | null = this.saveModList(Profile.getActiveProfile(), currentModList);
        if (saveError !== null) {
            return saveError;
        }
        // Return mod list, or R2 error. We don't care at this point as this is handled elsewhere.
        return this.getModList(Profile.getActiveProfile());
    }

    public static removeMod(mod: ManifestV2): ManifestV2[] | R2Error {
        const currentModList: ManifestV2[] | R2Error = this.getModList(Profile.getActiveProfile());
        if (currentModList instanceof R2Error) {
            return currentModList;
        }
        const newModList = currentModList.filter((m: ManifestV2) => m.getName() !== mod.getName());
        const saveError: R2Error | null = this.saveModList(Profile.getActiveProfile(), newModList);
        if (saveError !== null) {
            return saveError;
        }
        // Return mod list, or R2 error. We don't care at this point.
        return this.getModList(Profile.getActiveProfile());
    }

    public static updateMod(mod: ManifestV2, apply: (mod: ManifestV2) => void): ManifestV2[] | R2Error {
        const list: ManifestV2[] | R2Error = this.getModList(Profile.getActiveProfile());
        if (list instanceof R2Error) {
            return list;
        }
        list.filter((filteringMod: ManifestV2) => filteringMod.getName() === mod.getName())
            .forEach((filteringMod: ManifestV2) => {
                apply(filteringMod);
            });
        const saveErr = this.saveModList(Profile.getActiveProfile(), list);
        if (saveErr instanceof R2Error) {
            return saveErr;
        }
        return this.getModList(Profile.getActiveProfile());
    }

    public static exportModList(): R2Error | void{
        const exportDirectory = path.join(PathResolver.ROOT, 'mods', 'exports');
        try {
            fs.ensureDirSync(exportDirectory);
        } catch(e) {
            const err: Error = e;
            return new R2Error('Failed to ensure directory exists', err.message);
        }
        const list: ManifestV2[] | R2Error = this.getModList(Profile.getActiveProfile());
        if (list instanceof R2Error) {
            return list;
        }
        const exportModList: ExportMod[] = list.map((manifestMod: ManifestV2) => ExportMod.fromManifest(manifestMod));
        const exportFormat = new ExportFormat(Profile.getActiveProfile().getProfileName(), exportModList);
        const exportPath = path.join(exportDirectory, `${Profile.getActiveProfile().getProfileName()}.r2z`);
        const zip = new AdmZip();
        zip.addFile('export.r2x', Buffer.from(yaml.stringify(exportFormat)));
        zip.addLocalFolder(path.join(Profile.getActiveProfile().getPathOfProfile(), 'BepInEx', 'config'), 'config');
        zip.writeZip(exportPath);
        spawn('powershell.exe', ['explorer', `/select,${exportPath}`]);
    }

    public static shiftModEntryUp(mod: ManifestV2): ManifestV2[] | R2Error {
        let list: ManifestV2[] | R2Error = this.getModList(Profile.getActiveProfile());
        if (list instanceof R2Error) {
            return list;
        }
        const index = list.findIndex((stored: ManifestV2) => stored.getName() === mod.getName())
        if (index === 0) {
            return list;
        } else {
            list = list.filter((stored: ManifestV2) => stored.getName() !== mod.getName());
            const start = list.slice(0, index - 1);
            const end = list.slice(index - 1);
            list = [...start, mod, ...end];
        }
        const saveErr = this.saveModList(Profile.getActiveProfile(), list);
        if (saveErr instanceof R2Error) {
            return saveErr;
        }
        return this.getModList(Profile.getActiveProfile());
    }

    public static shiftModEntryDown(mod: ManifestV2): ManifestV2[] | R2Error {
        let list: ManifestV2[] | R2Error = this.getModList(Profile.getActiveProfile());
        if (list instanceof R2Error) {
            return list;
        }
        const index = list.findIndex((stored: ManifestV2) => stored.getName() === mod.getName())
        if (index === list.length) {
            return list;
        } else {
            list = list.filter((stored: ManifestV2) => stored.getName() !== mod.getName());
            const start = list.slice(0, index + 1);
            const end = list.slice(index + 1);
            list = [...start, mod, ...end];
        }
        const saveErr = this.saveModList(Profile.getActiveProfile(), list);
        if (saveErr instanceof R2Error) {
            return saveErr;
        }
        return this.getModList(Profile.getActiveProfile());
    }

}